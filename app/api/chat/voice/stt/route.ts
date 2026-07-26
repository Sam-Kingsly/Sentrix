import catalyst from 'zcatalyst-sdk-node';

export async function POST(req: Request) {
  try {
    // Parse the incoming audio file from the frontend FormData
    const formData = await req.formData();
    const audioFile = formData.get('audio') as Blob;
    const language = formData.get('language') as string;
    
    if (!audioFile) {
      return new Response(JSON.stringify({ error: 'No audio file provided' }), { status: 400 });
    }

    // Initialize Catalyst App
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const catalystApp = catalyst.initialize({ headers });

    // Convert Blob to Buffer for the SDK
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    
    // Access Zia Services (Hackathon beta implementation)
    const zia = catalystApp.zia();
    
    // Process the audio buffer. Fallbacks to Tamil if no language is passed.
    // We use (zia as any) to bypass strict TypeScript checks for the beta method.
    const sttResult = await (zia as any).speechToText(audioBuffer, { 
      language: language || 'ta-IN' 
    });

    return new Response(JSON.stringify({ text: sttResult.text }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Zia STT Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to transcribe audio' }), { status: 500 });
  }
}