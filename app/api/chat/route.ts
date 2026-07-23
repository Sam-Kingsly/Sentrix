import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    
    const recentMessages = messages.slice(-5);
    const latestMessage = recentMessages[recentMessages.length - 1]?.content.toLowerCase() || '';

    const fullIdMatches = latestMessage.match(/cr-\d{4}-\d{3}/gi) || [];
    const numericMatches = latestMessage.match(/\b(\d{1,3})\b/g) || [];

    let targetIds: string[] = [...fullIdMatches.map((id: string) => id.toUpperCase())];

    if (numericMatches.length > 0 && (latestMessage.includes('case') || latestMessage.includes('id') || latestMessage.includes('compare') || latestMessage.includes('predict') || latestMessage.includes('solution') || latestMessage.includes('similar'))) {
      const formattedNums = numericMatches.map((num: string) => `CR-2026-${num.padStart(3, '0')}`);
      targetIds = [...targetIds, ...formattedNums];
    }

    targetIds = [...new Set(targetIds)];

    let caseFiles: any[] = [];
    
    const isMacroAnalysis = latestMessage.includes('scan') || 
                            latestMessage.includes('connect') || 
                            latestMessage.includes('pattern') ||
                            latestMessage.includes('track') ||
                            latestMessage.includes('hotspot') ||
                            latestMessage.includes('trend') ||
                            latestMessage.includes('repeat') ||
                            latestMessage.includes('similar');

    if (targetIds.length > 0 && !isMacroAnalysis) {
      const { data } = await supabase.from('crimes').select('*').in('Case_ID', targetIds).limit(10);
      caseFiles = data || [];
    } else {
      const { data } = await supabase.from('crimes').select('*').limit(50);
      caseFiles = data || [];
    }

    const databaseContext = caseFiles.map(c => 
      `${c.Case_ID}|${c.Date}|${c.Location_Lat},${c.Location_Lng}|${c.Crime_Type}|${c.Accused_Name}|${c.Victim_Name}|${c.Status}|${c.FIR_Summary}`
    ).join('\n');

    const systemPrompt = `
      You are an elite Predictive Crime Analyst and Law Enforcement AI Assistant.
      
      Database Context:
      ${databaseContext}

      CRITICAL INSTRUCTIONS:
      - You MUST ALWAYS respond strictly in **ENGLISH**.
      - **VISUAL EVIDENCE PROTOCOL:** If the user uploads an image (like a CCTV still or crime scene photo), analyze it carefully. Describe what you see, identify potential clues (weapons, vehicles, demographics), and cross-reference it with the database context if asked.
      - **GEOLOCATION PROTOCOL:** If you predict a location or analyze a hotspot, include \`[MAP: Latitude, Longitude]\` at the end.
      - Format beautifully using markdown (**bolding**, bullet points, headers).
    `;

    // Format messages for Groq Vision capability
    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...recentMessages.map((m: any) => {
        // If the message contains an image, format it as a multipart array
        if (m.image) {
          return {
            role: m.role,
            content: [
              { type: 'text', text: m.content || 'Analyze this visual evidence.' },
              { type: 'image_url', image_url: { url: m.image } }
            ]
          };
        }
        // Otherwise, send as standard text
        return { role: m.role, content: m.content };
      })
    ];

    const completion = await groq.chat.completions.create({
      // 🚀 Changed from the deprecated Llama model to Groq's active Qwen 3.6 Vision model
      model: 'qwen/qwen3.6-27b', 
      messages: formattedMessages,
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err: any) {
    console.error('API Error:', err);
    return Response.json({ content: 'Error processing query.' }, { status: 500 });
  }
}