'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('en-IN'); 
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  
  // 🔥 NEW: State to track which message is currently being read aloud
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recog = new SpeechRecognition();
      recog.continuous = false;
      recog.interimResults = true; 
      recog.maxAlternatives = 1;   

      recog.onstart = () => setIsListening(true);
      recog.onend = () => setIsListening(false);
      recog.onerror = () => setIsListening(false);

      recog.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) setInput(transcript);
      };

      recognitionRef.current = recog;
    }
  }, []);

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    if (recognitionRef.current) {
      recognitionRef.current.lang = newLang;
      if (isListening) {
        recognitionRef.current.stop();
        setTimeout(() => recognitionRef.current.start(), 300);
      }
    }
  };

  const startVoiceInput = () => {
    if (!recognitionRef.current) return alert('Speech recognition is only supported in Chrome or Edge.');
    try {
      recognitionRef.current.lang = language;
      if (isListening) {
        recognitionRef.current.stop();
        setIsListening(false);
      } else {
        recognitionRef.current.start();
      }
    } catch (err) {
      setIsListening(false);
    }
  };

  // 🔥 UPGRADED: Toggle speech function with <think> tag stripping
  const toggleSpeech = (id: string, text: string) => {
    if ('speechSynthesis' in window) {
      // If this message is already playing, stop it and clear the state
      if (speakingMessageId === id) {
        window.speechSynthesis.cancel();
        setSpeakingMessageId(null);
        return;
      }

      // Otherwise, stop anything currently playing and start the new message
      window.speechSynthesis.cancel(); 
      
      // Strip <think> blocks and [MAP] tags before reading
      const cleanText = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[MAP:\s*([0-9.-]+)\s*,\s*([0-9.-]+)\]/gi, '')
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      
      // Use the currently selected mic language for output if you want, 
      // or default to English for the AI's responses
      utterance.lang = 'en-IN'; 

      // Update state when audio starts and finishes
      utterance.onstart = () => setSpeakingMessageId(id);
      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);

      window.speechSynthesis.speak(utterance);
    }
  };

  // Cleanup speech synthesis when component unmounts to prevent ghost audio
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const exportPDF = () => {
    window.print();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("Please upload an image smaller than 5MB for the demo.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmitMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !selectedImage) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const newUserMessage: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      content: input || 'Analyze this visual evidence.',
      image: selectedImage || undefined
    };

    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setInput('');
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsLoading(true);

    const aiMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: aiMessageId, role: 'assistant', content: '' }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
        signal: abortControllerRef.current.signal, 
      });

      if (!response.ok) throw new Error('Failed to fetch AI response');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No reader available');

      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;
        
        setMessages(prev =>
          prev.map(m => m.id === aiMessageId ? { ...m, content: accumulatedText } : m)
        );
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m => m.id === aiMessageId ? { ...m, content: 'Error processing evidence.' } : m)
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        /* 🔥 Import Outfit Font */
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');

        /* Custom Modern Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
        
        body { margin: 0; background-color: #050B14; }

        .markdown-body p { margin-top: 0; margin-bottom: 10px; }
        .markdown-body ul { padding-left: 20px; margin-bottom: 10px; }
        .markdown-body strong { color: inherit; font-weight: 600; }

        @media print {
          body, html { background: #ffffff !important; color: #000000 !important; height: auto !important; }
          .no-print { display: none !important; }
          .print-container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: #fff !important;}
          .print-area { display: block !important; height: auto !important; overflow: visible !important; }
          .chat-bubble { display: block !important; width: 100% !important; background: #f8fafc !important; border: 1px solid #cbd5e1 !important; color: #0f172a !important; margin-bottom: 20px !important; break-inside: auto !important; }
          .chat-bubble strong { color: #000000 !important; }
        }
      `}</style>

      <div className="print-container" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100vh', 
        maxWidth: '1000px', 
        margin: '0 auto', 
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#e2e8f0',
        padding: '0 20px'
      }}>
        
        {/* Header - Glassmorphic */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px 0', 
          borderBottom: '1px solid rgba(30, 41, 59, 0.5)',
          background: 'rgba(5, 11, 20, 0.8)',
          backdropFilter: 'blur(10px)',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#00f0ff', letterSpacing: '1px', fontSize: '22px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: "'Outfit', sans-serif", fontWeight: 800 }}>
              <span style={{ fontSize: '24px' }}>⚡</span> 𝐒ᴇɴᴛʀɪx
            </h2>
            <p style={{ margin: '4px 0 0 38px', fontSize: '12px', color: '#64748b', fontWeight: 500, letterSpacing: '0.5px' }}>
              Autonomous Crime Intelligence Platform
            </p>
          </div>
          
          <button 
            onClick={exportPDF} 
            className="no-print"
            style={{ 
              padding: '8px 16px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', 
              border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '20px', 
              cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', 
              transition: 'all 0.2s ease' 
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'}
          >
            📄 Export PDF
          </button>
        </div>

        {/* Chat Feed Area */}
        <div className="print-area" style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '30px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px'
        }}>
          {messages.length === 0 && (
            <div className="no-print" style={{ textAlign: 'center', color: '#475569', margin: 'auto', maxWidth: '400px' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px', color: '#00f0ff', opacity: 0.5, fontFamily: "'Outfit', sans-serif", fontWeight: 800 }}>⛑️ 𝐒ᴇɴᴛʀɪx</div>
              <p style={{ fontSize: '16px', fontWeight: 500, color: '#94a3b8' }}>Secure Connection Established.</p>
              <p style={{ fontSize: '13px', lineHeight: '1.6' }}>
                Upload visual evidence, request pattern tracking, or analyze case hotspots.
              </p>
            </div>
          )}

          {messages.map(m => {
            const isUser = m.role === 'user';
            
            const mapRegex = /\[MAP:\s*([0-9.-]+)\s*,\s*([0-9.-]+)\]/i;
            const mapMatch = m.content.match(mapRegex);
            const cleanContent = m.content
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .replace(mapRegex, '')
              .trim();
            
            let lat = null, lng = null;
            if (mapMatch) {
              lat = parseFloat(mapMatch[1]);
              lng = parseFloat(mapMatch[2]);
            }

            const isCurrentlySpeaking = speakingMessageId === m.id;

            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                <div className="chat-bubble" style={{ 
                  maxWidth: '80%', 
                  padding: '16px 20px', 
                  borderRadius: isUser ? '20px 20px 4px 20px' : '20px 20px 20px 4px', 
                  background: isUser ? 'rgba(0, 240, 255, 0.05)' : '#0F172A', 
                  color: isUser ? '#e0f2fe' : '#f8fafc', 
                  border: isUser ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid #1E293B',
                  boxShadow: isUser ? '0 4px 20px rgba(0, 240, 255, 0.05)' : '0 4px 20px rgba(0, 0, 0, 0.2)',
                  fontSize: '15px',
                  lineHeight: '1.6',
                  position: 'relative'
                }}>
                  <div style={{ 
                    fontSize: '13px', 
                    letterSpacing: '1px', 
                    marginBottom: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    {isUser ? (
                      <span style={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', fontSize: '11px' }}>🕵️ INVESTIGATOR</span>
                    ) : (
                      <span style={{ 
                        fontFamily: "'Outfit', sans-serif", 
                        fontWeight: 800, 
                        color: '#00f0ff',
                        letterSpacing: '1px',
                        textShadow: '0 0 10px rgba(0, 240, 255, 0.4)'
                      }}>
                        🤖 𝐒ᴇɴᴛʀɪx
                      </span>
                    )}
                  </div>
                  
                  {m.image && (
                    <div style={{ marginBottom: '12px' }}>
                      <img src={m.image} alt="Evidence" style={{ maxWidth: '300px', borderRadius: '12px', border: '1px solid rgba(0, 240, 255, 0.2)' }} />
                    </div>
                  )}

                  <div className="markdown-body">
                    <ReactMarkdown>{cleanContent}</ReactMarkdown>
                  </div>

                  {!isUser && lat && lng && (
                    <div style={{ marginTop: '20px', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
                      <div className="map-fallback" style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '8px 14px', fontSize: '11px', color: '#ef4444', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(239, 68, 68, 0.3)' }}>
                        <span style={{ fontFamily: "'Outfit', sans-serif", letterSpacing: '1px' }}>📍 TARGET ACQUIRED</span>
                        <span style={{ fontFamily: 'monospace' }}>{lat.toFixed(4)}, {lng.toFixed(4)}</span>
                      </div>
                      <iframe
                        className="no-print"
                        width="100%"
                        height="220"
                        style={{ border: 0, filter: 'invert(100%) hue-rotate(180deg) contrast(120%) opacity(0.85)' }} 
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01}%2C${lat - 0.01}%2C${lng + 0.01}%2C${lat + 0.01}&layer=mapnik&marker=${lat}%2C${lng}`}
                        allowFullScreen
                      ></iframe>
                    </div>
                  )}
                  
                  {/* 🔥 UPGRADED: Dynamic Audio Control Button */}
                  {!isUser && (
                    <button 
                      className="no-print" 
                      onClick={() => toggleSpeech(m.id, m.content)} 
                      style={{ 
                        marginTop: '12px', fontSize: '12px', 
                        background: isCurrentlySpeaking ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 240, 255, 0.1)', 
                        border: isCurrentlySpeaking ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(0, 240, 255, 0.2)', 
                        borderRadius: '12px', cursor: 'pointer', 
                        color: isCurrentlySpeaking ? '#ef4444' : '#00f0ff', 
                        padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = isCurrentlySpeaking ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 240, 255, 0.2)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = isCurrentlySpeaking ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 240, 255, 0.1)';
                      }}
                    >
                      {isCurrentlySpeaking ? '🛑 Stop Reading' : '🔊 Read Aloud'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Floating Input Dock Area */}
        <div className="no-print" style={{ 
          padding: '20px 0 30px 0',
          background: 'linear-gradient(to top, #050B14 80%, transparent)'
        }}>
          
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            
            {/* Language & Image Toggles (Above Input) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '10px', padding: '0 10px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mic Lang:</span>
                {['en-IN', 'ta-IN', 'kn-IN'].map((lang) => (
                  <button key={lang} type="button" onClick={() => handleLanguageChange(lang)} 
                    style={{ 
                      padding: '4px 10px', borderRadius: '12px', 
                      border: `1px solid ${language === lang ? '#00f0ff' : '#1e293b'}`, 
                      background: language === lang ? 'rgba(0, 240, 255, 0.1)' : 'transparent', 
                      color: language === lang ? '#00f0ff' : '#64748b', 
                      cursor: 'pointer', fontSize: '11px', fontWeight: 600, transition: 'all 0.2s'
                    }}>
                    {lang === 'en-IN' ? 'ENG' : lang === 'ta-IN' ? 'TAM' : 'KAN'}
                  </button>
                ))}
              </div>

              {selectedImage && (
                <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 240, 255, 0.1)', padding: '4px 8px', borderRadius: '12px', border: '1px solid rgba(0, 240, 255, 0.3)' }}>
                  <img src={selectedImage} alt="Preview" style={{ height: '24px', borderRadius: '4px', marginRight: '8px' }} />
                  <button onClick={removeImage} style={{ background: 'transparent', color: '#00f0ff', border: 'none', cursor: 'pointer', fontSize: '14px', padding: 0 }}>✕</button>
                </div>
              )}
            </div>

            {/* Glowing Pill Input Box */}
            <form onSubmit={onSubmitMessage} style={{ 
              display: 'flex', 
              alignItems: 'center',
              background: '#0F172A', 
              border: `1px solid ${inputFocused ? '#00f0ff' : '#1E293B'}`, 
              boxShadow: inputFocused ? '0 0 20px rgba(0, 240, 255, 0.15)' : '0 10px 25px rgba(0,0,0,0.5)',
              borderRadius: '24px', 
              padding: '6px 10px',
              transition: 'all 0.3s ease'
            }}>
              
              <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
              
              <button type="button" onClick={() => fileInputRef.current?.click()} 
                style={{ padding: '10px', background: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.color = '#00f0ff'}
                onMouseOut={(e) => e.currentTarget.style.color = '#94a3b8'}
                title="Attach Image"
              >
                📎
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={isListening ? "Listening closely..." : "Ask 𝐒ᴇɴᴛʀɪx for database analytics or evidence scans..."}
                style={{ 
                  flex: 1, padding: '12px 10px', background: 'transparent', 
                  border: 'none', color: '#f8fafc', outline: 'none', fontSize: '15px' 
                }}
              />
              
              <button type="button" onClick={startVoiceInput} 
                style={{ 
                  padding: '10px', background: isListening ? 'rgba(239, 68, 68, 0.2)' : 'transparent', 
                  color: isListening ? '#ef4444' : '#94a3b8', border: 'none', borderRadius: '50%', 
                  cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', marginRight: '4px',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => { if(!isListening) e.currentTarget.style.color = '#00f0ff'}}
                onMouseOut={(e) => { if(!isListening) e.currentTarget.style.color = '#94a3b8'}}
              >
                {isListening ? '🎙️' : '🎤'}
              </button>
              
              <button type="submit" disabled={isLoading} 
                style={{ 
                  padding: '10px 20px', background: isLoading ? '#1e293b' : '#00f0ff', 
                  color: isLoading ? '#050b14' : '#050b14', border: 'none', borderRadius: '20px', 
                  cursor: isLoading ? 'default' : 'pointer', fontWeight: 700, fontSize: '14px',
                  fontFamily: "'Outfit', sans-serif", letterSpacing: '1px',
                  transition: 'all 0.2s', boxShadow: isLoading ? 'none' : '0 0 15px rgba(0, 240, 255, 0.4)'
                }}
              >
                {isLoading ? 'SCANNING' : 'SEND'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}