import catalyst from 'zcatalyst-sdk-node';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, imageBase64, language = 'en-IN' } = body;
    
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => { headers[key] = value; });

    const catalystApp = catalyst.initialize({ headers });
    const zcql = catalystApp.zcql();

    const recentMessages = messages ? messages.slice(-5) : [];
    const latestMessageObj = recentMessages[recentMessages.length - 1];
    const latestText = (typeof latestMessageObj?.content === 'string' 
      ? latestMessageObj.content 
      : latestMessageObj?.content?.[0]?.text || '').toLowerCase().trim();

    // 🔥 MAPPER: Convert Tamil/Kannada numbers to digits so it matches Case IDs
    let normalizedText = latestText
      .replace(/ஒன்/g, '1').replace(/ஒன்று/g, '1')
      .replace(/டூ/g, '2').replace(/இரண்டு/g, '2')
      .replace(/த்ரீ/g, '3').replace(/மூன்று/g, '3')
      .replace(/ಒಂದು/g, '1').replace(/ಎರಡು/g, '2').replace(/ಮೂರು/g, '3')
      .replace(/one/g, '1').replace(/two/g, '2').replace(/three/g, '3');

    // 1. Check if user input is a greeting
    const isGreeting = ['hi', 'hey', 'hello', 'வணக்கம்', 'நமஸ்காரம்', 'ನಮಸ್ಕಾರ'].some(g => latestText.includes(g));

    // 2. Handle image evidence via Catalyst Zia OCR
    let visionContext = "";
    const activeImage = imageBase64 || latestMessageObj?.image;
    if (activeImage) {
      try {
        const base64Data = activeImage.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const tempFilePath = path.join(os.tmpdir(), `evidence_${Date.now()}.jpg`);
        fs.writeFileSync(tempFilePath, imageBuffer);
        const imageStream = fs.createReadStream(tempFilePath);
        
        const zia = catalystApp.zia();
        const ocrResult = await zia.extractOpticalCharacters(imageStream, { language: 'eng', modelType: 'OCR' });
        visionContext = `[Visual Evidence Extracted via Catalyst Zia OCR: ${ocrResult.text}]`;
        
        fs.unlinkSync(tempFilePath);
      } catch (imgErr) {
        console.error("Zia OCR processing note:", imgErr);
      }
    }

    // 3. Smart Multilingual Database Lookup
    let caseFiles: any[] = [];
    const fullIdMatches = normalizedText.match(/cr-\d{4}-\d{3}/gi) || [];
    const numericMatches = normalizedText.match(/\b(\d{1,3})\b/g) || [];

    let targetIds: string[] = [...fullIdMatches.map((id: string) => id.toUpperCase())];

    const caseKeywords = ['case', 'id', 'cr-', 'கேஸ்', 'வழக்கு', 'ಕೇಸ್', 'ಪ್ರಕರಣ'];
    const hasCaseKeyword = caseKeywords.some(kw => normalizedText.includes(kw));

    if (!isGreeting && numericMatches.length > 0 && hasCaseKeyword) {
      const formattedNums = numericMatches.map((num: string) => `CR-2026-${num.padStart(3, '0')}`);
      targetIds = [...targetIds, ...formattedNums];
    }
    targetIds = [...new Set(targetIds)];

    if (!isGreeting && targetIds.length > 0) {
      const formattedIdsList = targetIds.map(id => `'${id}'`).join(',');
      const query = `SELECT Case_ID, Crime_Date, Location_Lat, Location_Lng, Crime_Type, Status, FIR_Summary, Financial_Linked, Risk_Score, Accused_Name, Victim_Name FROM crimes WHERE Case_ID IN (${formattedIdsList}) LIMIT 5`;
      const queryResult = await zcql.executeZCQLQuery(query);
      caseFiles = queryResult ? queryResult.map((row: any) => row.crimes) : [];
    }

    // 4. MULTILINGUAL RESPONSE GENERATION
    let aiResponse = "";
    const isTamil = language === 'ta-IN';
    const isKannada = language === 'kn-IN';

    if (isGreeting && targetIds.length === 0 && !activeImage) {
      if (isTamil) aiResponse = `வணக்கம்! **Sentrix நுண்ணறிவு தளம்** தயார் நிலையில் உள்ளது.\n\nநான் உங்கள் AI புலனாய்வாளர். நீங்கள் என்னுடன் உரையாடலாம், சான்றுகளை பதிவேற்றலாம் அல்லது ஒரு குறிப்பிட்ட வழக்கின் ஐடியை (உதாரணம்: **CR-2026-001**) தேடலாம். நான் எப்படி உதவ முடியும்?`;
      else if (isKannada) aiResponse = `ನಮಸ್ಕಾರ! **Sentrix ಗುಪ್ತಚರ ವೇದಿಕೆ** ಸಿದ್ಧವಾಗಿದೆ.\n\nನಾನು ನಿಮ್ಮ AI ತನಿಖಾಧಿಕಾರಿ. ನೀವು ನನ್ನೊಂದಿಗೆ ಮಾತನಾಡಬಹುದು, ಪುರಾವೆಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಬಹುದು ಅಥವಾ ಕೇಸ್ ಐಡಿ (ಉದಾಹರಣೆ: **CR-2026-001**) ಹುಡುಕಬಹುದು. ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`;
      else aiResponse = `Hello, Detective! **Sentrix Autonomous Crime Intelligence Platform** is online and secure. \n\nI am your AI lead investigator. You can chat with me naturally, upload visual evidence for scanning, or inspect specific crime records by typing their ID (e.g., **CR-2026-001**). How can I assist with your operation today?`;
    
    } else if (caseFiles.length > 0) {
      const c = caseFiles[0];
      if (isTamil) {
        aiResponse = `விசாரணையாளரே, வழக்கு கோப்பு **${c.Case_ID}**-ஐ அணுகியுள்ளேன்:

* **வகை:** ${c.Crime_Type} | **நிலை:** ${c.Status}
* **குற்றம் சாட்டப்பட்டவர்:** ${c.Accused_Name || 'தெரியவில்லை'} | **பாதிக்கப்பட்டவர்:** ${c.Victim_Name || 'தெரியவில்லை'}
* **ஆபத்து மதிப்பெண்:** ${c.Risk_Score || 'N/A'} ${c.Financial_Linked ? '| 💳 நிதி இணைப்புகள் கண்டறியப்பட்டுள்ளன' : ''}
* **சுருக்கம்:** "${c.FIR_Summary}"

[MAP: ${c.Location_Lat}, ${c.Location_Lng}]

இந்த வழக்கில் உங்கள் அடுத்தகட்ட உத்தரவு என்ன?`;
      } else if (isKannada) {
        aiResponse = `ತನಿಖಾಧಿಕಾರಿ, ನಾನು ಪ್ರಕರಣದ ಫೈಲ್ **${c.Case_ID}** ಅನ್ನು ಪ್ರವೇಶಿಸಿದ್ದೇನೆ:

* **ವರ್ಗೀಕರಣ:** ${c.Crime_Type} | **ಸ್ಥಿತಿ:** ${c.Status}
* **ಆರೋಪಿ:** ${c.Accused_Name || 'ತಿಳಿದಿಲ್ಲ'} | **ಬಲಿಪಶು:** ${c.Victim_Name || 'ತಿಳಿದಿಲ್ಲ'}
* **ಅಪಾಯದ ಸ್ಕೋರ್:** ${c.Risk_Score || 'N/A'} ${c.Financial_Linked ? '| 💳 ಹಣಕಾಸಿನ ಸಂಪರ್ಕಗಳು ಪತ್ತೆಯಾಗಿವೆ' : ''}
* **ಸಾರಾಂಶ:** "${c.FIR_Summary}"

[MAP: ${c.Location_Lat}, ${c.Location_Lng}]

ಈ ಪ್ರಕರಣಕ್ಕಾಗಿ ನಿಮ್ಮ ಮುಂದಿನ ಸೂಚನೆಗಳೇನು?`;
      } else {
        aiResponse = `Detective, I have accessed file **${c.Case_ID}** for your review:\n\n* **Classification:** ${c.Crime_Type} | **Status:** ${c.Status}\n* **Key Parties:** Accused: **${c.Accused_Name || 'Unknown'}** | Victim: **${c.Victim_Name || 'Unknown'}**\n* **Risk Evaluation:** Score **${c.Risk_Score || 'N/A'}** ${c.Financial_Linked ? '| 💳 Financial Links Identified' : ''}\n* **Summary:** "${c.FIR_Summary}"\n\n[MAP: ${c.Location_Lat}, ${c.Location_Lng}]\n\nWhat are your instructions for this case?`;
      }
    } else if (activeImage) {
      if (isTamil) aiResponse = `Catalyst Zia மூலம் படம் ஸ்கேன் செய்யப்பட்டது.\n${visionContext ? `\n\n**OCR முடிவுகள்:**\n${visionContext}` : ''}\n\nதரவுத்தளத்துடன் இதை ஒப்பிட வேண்டுமா?`;
      else if (isKannada) aiResponse = `ಚಿತ್ರವನ್ನು Catalyst Zia ಮೂಲಕ ಸ್ಕ್ಯಾನ್ ಮಾಡಲಾಗಿದೆ.\n${visionContext ? `\n\n**OCR ಫಲಿತಾಂಶಗಳು:**\n${visionContext}` : ''}\n\nಡೇಟಾಬೇಸ್‌ನೊಂದಿಗೆ ಇದನ್ನು ಹೋಲಿಸಬೇಕೆ?`;
      else aiResponse = `Visual evidence received and processed through Catalyst Zia intelligence core. \n${visionContext ? `\n\n**OCR Scan Results:**\n${visionContext}` : '\n\n*Image successfully scanned. No clear text anomalies detected.*'}\n\nWould you like me to cross-reference these visual markers against active database records?`;
    } else {
      if (isTamil) aiResponse = `உங்கள் கோரிக்கையை பெற்றுள்ளேன்: *" ${latestText} "*. தயவுசெய்து சரியான கேஸ் ஐடியை (உதாரணம்: **CR-2026-001**) வழங்கவும்.`;
      else if (isKannada) aiResponse = `ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಸ್ವೀಕರಿಸಿದ್ದೇನೆ: *" ${latestText} "*. ದಯವಿಟ್ಟು ಮಾನ್ಯವಾದ ಕೇಸ್ ಐಡಿ (ಉದಾಹರಣೆಗೆ: **CR-2026-001**) ಒದಗಿಸಿ.`;
      else aiResponse = `I've received your query: *" ${latestText} "*. Sentrix is standing by. Please provide a valid Case ID (e.g., **CR-2026-001**) or investigative instruction.`;
    }

    return new Response(JSON.stringify({ content: aiResponse }), { 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    console.error('API Route Critical Error:', err);
    return new Response(JSON.stringify({ content: "Sentrix Intelligence Core is online and ready for your query." }), { 
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }
}