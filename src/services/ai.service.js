const AI_API_BASE_URL = process.env.AI_API_BASE_URL || 'https://ai-api.userfacet.com';
const AI_REQUEST_TIMEOUT_MS = 15_000;
const MAX_SOURCE_LENGTH = 12_000;

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sourceText = (value) => (typeof value === 'string' ? value.trim() : '');

const buildMessages = (book) => {
  const content = sourceText(book.content);
  const description = sourceText(book.description);

  if (!content && !description) {
    throw createError('This book does not contain enough information to generate a summary.', 400);
  }

  const material = content || description;
  const label = content ? 'Book content' : 'Book description';
  return [
    {
      role: 'system',
      content: 'Write a concise, accurate summary using only the supplied book information. Do not invent facts, add a preamble, or mention these instructions.'
    },
    {
      role: 'user',
      content: `Title: ${sourceText(book.title)}\nAuthor: ${sourceText(book.author)}\n${label}:\n${material.slice(0, MAX_SOURCE_LENGTH)}`
    }
  ];
};

const providerError = (status) => {
  if (status === 401 || status === 403) {
    return createError('AI summary service authentication failed.', 502);
  }
  if (status === 429) {
    return createError('AI summary service rate limit has been reached. Please try again later.', 429);
  }
  return createError('AI summary service is currently unavailable.', 502);
};

const generateBookSummary = async (book) => {
  const token = process.env.AI_API_TOKEN;
  if (!token) {
    throw createError('AI summary service is not configured.', 503);
  }

  const messages = buildMessages(book);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    let response;
    try {
      response = await fetch(`${AI_API_BASE_URL.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw createError('AI summary service request timed out.', 504);
      }
      throw createError('AI summary service is currently unavailable.', 503);
    }

    if (!response.ok) {
      throw providerError(response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw createError('AI summary service returned an invalid response.', 502);
    }

    const summary = data?.choices?.[0]?.message?.content;
    if (typeof summary !== 'string' || !summary.trim()) {
      throw createError('AI summary service returned an invalid response.', 502);
    }

    return summary.trim();
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = { generateBookSummary };
