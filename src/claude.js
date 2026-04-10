const Anthropic = require('@anthropic-ai/sdk');
const { trackUsage } = require('./usage');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseJSON(raw) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(text);
}

function track(response, tool, clientData) {
  const usage = response.usage || {};
  trackUsage({
    model: response.model || 'claude-opus-4-6',
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    tool,
    clientId: clientData ? clientData.id : null,
    clientName: clientData ? clientData.name : null,
  });
}

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

  track(response, 'ads', clientData);

  const json = parseJSON(response.content[0].text);
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

  const internalLinksSection = clientData.internalLinks && clientData.internalLinks.length
    ? `\nInternal links to include naturally in the content. Include at least one, only add multiple if genuinely relevant to the topic:\n${clientData.internalLinks.map(l => `- ${l.label}: ${l.url}`).join('\n')}\nFormat links as HTML anchor tags, e.g. <a href="URL">anchor text</a>.`
    : '';

  let typeInstruction;
  if (contentType === 'blog') {
    typeInstruction = `Blog post topic: ${subject}`;
  } else if (contentType === 'location') {
    typeInstruction = `Target location: ${subject}`;
  } else {
    typeInstruction = `Target service: ${subject}`;
  }

  const prompt = `You are an expert SEO content writer for a UK marketing agency. Write in British English throughout.

Generate a full SEO ${contentType === 'blog' ? 'blog post' : contentType === 'location' ? 'location page' : 'service page'} for the following:

Client: ${clientData.name}
Industry: ${clientData.industry}
Tone of voice: ${clientData.toneOfVoice}
Key messages: ${clientData.keyMessages.join(', ')}
${clientData.avoidPhrases.length ? `Phrases to avoid: ${clientData.avoidPhrases.join(', ')}` : ''}
${typeInstruction}
${clientData.defaultService ? `Core service focus: ${clientData.defaultService} (weave this service naturally throughout the page alongside the location)` : ''}
${internalLinksSection}
${existingList}
${samplesSection}

Requirements:
- 600-800 words
- Must include one H1 and several H2 headings
- Naturally weave in the ${contentType === 'blog' ? 'topic' : contentType === 'location' ? 'location' : 'service'} throughout
- Written in the client's tone of voice
${docSamples && docSamples.length ? '- Match the format and structure of the existing samples above' : ''}
- Unique — do not repeat phrases or structure from any existing content listed above
- British English throughout
- Strong call to action at the end

Respond with ONLY valid JSON in this exact format, no other text:
{
  "pageTitle": "SEO page title (60 chars max)",
  "urlSlug": "url-slug-suggestion",
  "navigationNote": "Brief note on where this page should sit in the site navigation",
  "content": "Full page content here. Use # for H1 and ## for H2 headings. Plain text otherwise. Include HTML anchor tags for internal links."
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  track(response, 'content', clientData);

  return parseJSON(response.content[0].text);
}

async function generateBlogIdeas({ clientData, count, existingTitles }) {
  const existingList = existingTitles.length
    ? `\nExisting blog posts and content already written (do not suggest similar topics):\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  const internalLinksContext = clientData.internalLinks && clientData.internalLinks.length
    ? `\nThe client's website has these service pages that blog posts should naturally link to:\n${clientData.internalLinks.map(l => `- ${l.label}: ${l.url}`).join('\n')}`
    : '';

  const prompt = `You are a content strategist for a UK marketing agency. Think about what blog topics would work well for SEO and would be genuinely useful to potential customers searching for services in this industry.

Client: ${clientData.name}
Industry: ${clientData.industry}
Services: ${clientData.services.join(', ')}
Key messages: ${clientData.keyMessages.join(', ')}
Tone of voice: ${clientData.toneOfVoice}
${internalLinksContext}
${existingList}

Generate ${count} blog post ideas. Each should:
- Be relevant to the client's industry and services
- Target a keyword or question potential customers would search for
- Be unique and not duplicate any existing content listed above
- Be suitable for a 600-800 word article

Respond with ONLY valid JSON in this exact format, no other text:
{
  "ideas": [
    { "title": "Blog post title", "description": "One-line description of what the post covers", "targetKeyword": "primary keyword to target" },
    ...
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  track(response, 'blog-ideas', clientData);

  return parseJSON(response.content[0].text);
}

module.exports = { generateAdsCopy, generateContent, generateBlogIdeas };
