import catalyst from 'zcatalyst-sdk-node';

export async function POST(req: Request) {
  try {
    const { text, language } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), { status: 400 });
    }

    // Initialize Catalyst App
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const catalystApp = catalyst.initialize({ headers });

    // Access Zia Services (Hackathon beta implementation)
    const zia = catalystApp.zia();
    
    // Request audio stream from Zia. Fallbacks to Tamil.
    const audioStream = await (zia as any).textToSpeech(text, { 
      language: language || 'ta-IN',
      voice: 'female'
    });

    // Convert the returned Node.js Readable stream into a standard Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
      }
    });

  } catch (err: any) {
    console.error('Zia TTS Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate speech' }), { status: 500 });
  }
}