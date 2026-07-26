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
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, isProcessingVoice]);

  // Clean up any playing audio if component unmounts
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    // If currently playing speech, stop it when language changes
    window.speechSynthesis.cancel();
    setSpeakingMessageId(null);
  };

  // 🎤 1. BUILT-IN NATIVE SPEECH-TO-TEXT (Bypasses Backend)
  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Your browser doesn't support built-in speech recognition. Please use Google Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language; 
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsRecording(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsRecording(false);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => setIsRecording(false);

    recognition.start();
  };

  // 🔊 2. BUILT-IN NATIVE TEXT-TO-SPEECH (Bypasses Backend)
  const toggleSpeech = (id: string, text: string) => {
    // If clicking the currently speaking message, stop it
    if (speakingMessageId === id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    // Stop any other playing audio
    window.speechSynthesis.cancel();
    setSpeakingMessageId(id);

    // Clean markdown syntax before reading aloud
    const cleanText = text
      .replace(/\[MAP:\s*([0-9.-]+)\s*,\s*([0-9.-]+)\]/gi, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_#`[\]()>-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = language;
    utterance.rate = 1.0; 
    utterance.pitch = 1.0;

    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);

    window.speechSynthesis.speak(utterance);
  };

  // Catalyst SmartBrowz PDF Generation
  const exportPDF = async () => {
    try {
      setIsLoading(true);
      const reportHtml = document.querySelector('.print-area')?.innerHTML || '<h1>Sentrix Report</h1>';
      
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          htmlContent: `<html><head><style>body{font-family:sans-serif;}</style></head><body>${reportHtml}</body></html>` 
        })
      });

      if (!response.ok) throw new Error("PDF generation failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Sentrix_Analysis.pdf';
      a.click();
    } catch (err) {
      console.error(err);
      alert("Failed to generate PDF via Catalyst SmartBrowz.");
    } finally {
      setIsLoading(false);
    }
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
    const currentImageBase64 = selectedImage; 
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsLoading(true);

    const aiMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: aiMessageId, role: 'assistant', content: '' }]);

    try {
      // Fetch Catalyst API Endpoint
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: updatedMessages,
          imageBase64: currentImageBase64,
          language: language
        }),
        signal: abortControllerRef.current.signal, 
      });

      if (!response.ok) throw new Error('Failed to fetch AI response');

      const data = await response.json();
      const aiText = data.content || "Analysis complete.";

      setMessages(prev =>
        prev.map(m => m.id === aiMessageId ? { ...m, content: aiText } : m)
      );

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m => m.id === aiMessageId ? { ...m, content: 'Error processing evidence with Catalyst Services.' } : m)
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');

        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
        
        body { margin: 0; background-color: #050B14; }

        .markdown-body p { margin-top: 0; margin-bottom: 10px; }
        .markdown-body ul { padding-left: 20px; margin-bottom: 10px; }
        .markdown-body strong { color: inherit; font-weight: 600; }

        @keyframes bounceDot {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.0); }
        }
        .dot-1 { animation: bounceDot 1.4s infinite ease-in-out both; animation-delay: -0.32s; }
        .dot-2 { animation: bounceDot 1.4s infinite ease-in-out both; animation-delay: -0.16s; }
        .dot-3 { animation: bounceDot 1.4s infinite ease-in-out both; }

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
        
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '16px 0', 
          borderBottom: '1px solid rgba(30, 41, 59, 0.5)',
          background: 'rgba(5, 11, 20, 0.8)',
          backdropFilter: 'blur(10px)',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img 
              src="/sentrix-logo.png" 
              alt="Sentrix Logo" 
              style={{ width: '38px', height: '38px', objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(0,240,255,0.6))' }} 
            />
            <div>
              <h2 style={{ margin: 0, color: '#00f0ff', letterSpacing: '1px', fontSize: '22px', fontFamily: "'Outfit', sans-serif", fontWeight: 800, textShadow: '0 0 12px rgba(0, 240, 255, 0.5)' }}>
                𝐒ᴇɴᴛʀɪx
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b', fontWeight: 500, letterSpacing: '0.5px' }}>
                Autonomous Crime Intelligence Platform
              </p>
            </div>
          </div>
          
          <button 
            onClick={exportPDF} 
            disabled={isLoading}
            className="no-print"
            style={{ 
              padding: '8px 16px', background: 'rgba(0, 240, 255, 0.1)', color: '#00f0ff', 
              border: '1px solid rgba(0, 240, 255, 0.3)', borderRadius: '20px', 
              cursor: isLoading ? 'default' : 'pointer', fontWeight: 'bold', fontSize: '13px', 
              boxShadow: '0 0 10px rgba(0, 240, 255, 0.15)',
              transition: 'all 0.2s ease',
              opacity: isLoading ? 0.5 : 1
            }}
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
            <div className="no-print" style={{ textAlign: 'center', color: '#475569', margin: 'auto', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <img 
                src="/sentrix-logo.png" 
                alt="Sentrix Center Logo" 
                style={{ width: '64px', height: '64px', objectFit: 'contain', filter: 'drop-shadow(0 0 15px rgba(0,240,255,0.8))' }} 
              />
              <p style={{ fontSize: '16px', fontWeight: 500, color: '#94a3b8', margin: 0 }}>Secure Connection Established.</p>
              <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
                Upload visual evidence, request pattern tracking, or analyze case hotspots via Catalyst.
              </p>
            </div>
          )}

          {messages.map((m, index) => {
            const isUser = m.role === 'user';
            const isLastMessage = index === messages.length - 1;
            const showLoadingDots = !isUser && isLoading && isLastMessage && !m.content.trim();
            
            const mapRegex = /\[MAP:\s*([0-9.-]+)\s*,\s*([0-9.-]+)\]/i;
            const mapMatch = m.content.match(mapRegex);
            const finalDisplayContent = m.content.replace(mapRegex, '').trim();
            
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
                  position: 'relative',
                  width: '100%'
                }}>
                  <div style={{ fontSize: '13px', letterSpacing: '1px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isUser ? (
                      <span style={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', fontSize: '11px' }}>🕵️ INVESTIGATOR</span>
                    ) : (
                      <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, color: '#00f0ff', letterSpacing: '1px', textShadow: '0 0 10px rgba(0, 240, 255, 0.4)' }}>
                        🤖 𝐒ᴇɴᴛʀɪx
                      </span>
                    )}
                  </div>
                  
                  {m.image && (
                    <div style={{ marginBottom: '12px' }}>
                      <img src={m.image} alt="Evidence" style={{ maxWidth: '300px', borderRadius: '12px', border: '1px solid rgba(0, 240, 255, 0.2)' }} />
                    </div>
                  )}

                  {showLoadingDots ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 0' }}>
                      <span className="dot-1" style={{ width: '8px', height: '8px', backgroundColor: '#00f0ff', borderRadius: '50%', display: 'inline-block' }}></span>
                      <span className="dot-2" style={{ width: '8px', height: '8px', backgroundColor: '#00f0ff', borderRadius: '50%', display: 'inline-block' }}></span>
                      <span className="dot-3" style={{ width: '8px', height: '8px', backgroundColor: '#00f0ff', borderRadius: '50%', display: 'inline-block' }}></span>
                    </div>
                  ) : (
                    <div className="markdown-body">
                      <ReactMarkdown>{finalDisplayContent}</ReactMarkdown>
                    </div>
                  )}

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
                  
                  {!isUser && finalDisplayContent && !showLoadingDots && (
                    <button 
                      className="no-print" 
                      onClick={() => toggleSpeech(m.id, finalDisplayContent)} 
                      style={{ 
                        marginTop: '12px', fontSize: '12px', 
                        background: isCurrentlySpeaking ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 240, 255, 0.1)', 
                        border: isCurrentlySpeaking ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(0, 240, 255, 0.2)', 
                        borderRadius: '12px', cursor: 'pointer', 
                        color: isCurrentlySpeaking ? '#ef4444' : '#00f0ff', 
                        padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px'
                      }}
                    >
                      {isCurrentlySpeaking ? '🛑 Stop Audio' : '🔊 Read Aloud'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="no-print" style={{ padding: '20px 0 30px 0', background: 'linear-gradient(to top, #050B14 80%, transparent)' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
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
                      cursor: 'pointer', fontSize: '11px', fontWeight: 600
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
                style={{ padding: '10px', background: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '18px' }}
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
                placeholder={isProcessingVoice ? "Processing speech..." : isRecording ? "Listening... (Speak now)" : "Ask 𝐒ᴇɴᴛʀɪx for database analytics or evidence scans..."}
                disabled={isRecording || isProcessingVoice}
                style={{ flex: 1, padding: '12px 10px', background: 'transparent', border: 'none', color: '#f8fafc', outline: 'none', fontSize: '15px' }}
              />
              
              <button type="button" onClick={toggleRecording} 
                disabled={isProcessingVoice}
                style={{ 
                  padding: '10px', 
                  background: isRecording ? 'rgba(239, 68, 68, 0.2)' : 'transparent', 
                  color: isRecording ? '#ef4444' : '#94a3b8', 
                  border: 'none', 
                  borderRadius: '50%', 
                  cursor: isProcessingVoice ? 'default' : 'pointer', 
                  fontSize: '18px',
                  opacity: isProcessingVoice ? 0.5 : 1
                }}
              >
                {isRecording ? '🛑' : '🎤'}
              </button>
              
              <button type="submit" disabled={isLoading || isRecording || isProcessingVoice} 
                style={{ 
                  padding: '10px 20px', background: isLoading ? '#1e293b' : '#00f0ff', 
                  color: '#050b14', border: 'none', borderRadius: '20px', 
                  cursor: (isLoading || isRecording || isProcessingVoice) ? 'default' : 'pointer', fontWeight: 700, fontSize: '14px',
                  fontFamily: "'Outfit', sans-serif", letterSpacing: '1px',
                  opacity: (isRecording || isProcessingVoice) ? 0.5 : 1
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