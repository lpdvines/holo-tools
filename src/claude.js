const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateAdsCopy({ clientData, service, location, notes }) {
  const prompt = `You are an expert Google Ads copywriter for a UK marketing agency.

Generate Google Ads copy for the following:

Client: ${clientData.name}
Industry: ${clientData.industry}
Tone of voice: ${clientData.toneOfVoice}
Key messages: ${clientData.keyMessages.join(', ')}
${clientData.avoidPhrases.length ? `Phrases to avoid: ${clientData.avoidPhrases.join(', ')}` : ''}
Service: ${service}
Location: ${location}
${notes ? `Additional notes: ${notes}` : ''}

Generate:
- 15 headlines — STRICT maximum 30 characters each (including spaces). Count every character carefully. Never exceed 30.
- 4 descriptions — STRICT maximum 90 characters each (including spaces). Count every character carefully. Never exceed 90.

Headlines should mix: service + location combinations, USPs from key messages, and calls to action.
Descriptions should expand on the service with a call to action.
Use British English throughout.
Reflect the client's tone of voice.

Respond with ONLY valid JSON in this exact format, no other text:
{
  "headlines": ["headline 1", "headline 2", ...],
  "descriptions": ["description 1", "description 2", "description 3", "description 4"]
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const json = JSON.parse(text);

  json.headlines = json.headlines.slice(0, 15).map(h => h.slice(0, 30));
  json.descriptions = json.descriptions.slice(0, 4).map(d => d.slice(0, 90));

  return json;
}

async function generateContent({ clientData, contentType, subject, existingTitles, docSamples }) {
  const existingList = existingTitles.length
    ? `\nExisting content already created (do not duplicate these):\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  const samplesSection = docSamples && docSamples.length
    ? `\nHere are samples of existing content written for this client. Match their format, structure and writing style closely:\n\n${docSamples.map(s => `--- ${s.name} ---\n${s.text}`).join('\n\n')}`
    : '';

  const prompt = `You are an expert SEO content writer for a UK marketing agency. Write in British English throughout.

Generate a full SEO ${contentType === 'location' ? 'location page' : 'service page'} for the following:

Client: ${clientData.name}
Industry: ${clientData.industry}
Tone of voice: ${clientData.toneOfVoice}
Key messages: ${clientData.keyMessages.join(', ')}
${clientData.avoidPhrases.length ? `Phrases to avoid: ${clientData.avoidPhrases.join(', ')}` : ''}
${contentType === 'location' ? `Target location: ${subject}` : `Target service: ${subject}`}
${existingList}
${samplesSection}

Requirements:
- 600-800 words
- Must include one H1 and several H2 headings
- Naturally weave in the ${contentType === 'location' ? 'location' : 'service'} throughout
- Written in the client's tone of voice
- Match the format and structure of the existing samples above
- Unique — do not repeat phrases or structure from any existing content listed above
- British English throughout
- Strong call to action at the end

Respond with ONLY valid JSON in this exact format, no other text:
{
  "pageTitle": "SEO page title (60 chars max)",
  "urlSlug": "url-slug-suggestion",
  "navigationNote": "Brief note on where this page should sit in the site navigation",
  "content": "Full page content here. Use # for H1 and ## for H2 headings. Plain text otherwise."
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(text);
}

module.exports = { generateAdsCopy, generateContent };
