const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SITE_URL = 'https://eonfl.com';
const SITE_NAME = '이온토플';
const FALLBACK_IMAGE = `${SITE_URL}/logo/og-default.png`;

const PAGE_CONFIG: Record<string, { table: string; defaultTitle: string }> = {
  'reviews': { table: 'reviews', defaultTitle: '후기 - 이온토플' },
  'reviews-book': { table: 'reviews_book', defaultTitle: '입문서 후기 - 이온토플' },
  'notice': { table: 'tr_notices', defaultTitle: '공지사항 - 이온토플' },
  'materials': { table: 'materials', defaultTitle: '학습 자료 - 이온토플' },
};

const CRAWLER_PATTERN =
  /kakaotalk|facebookexternalhit|twitterbot|slackbot|discordbot|linkedinbot|yeti|naver|daumoa|google-read-aloud|mediapartners-google/i;

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!match) return null;
  const src = match[1];
  if (src.startsWith('data:')) return null;
  if (src.startsWith('http')) return src;
  if (src.startsWith('/')) return `${SITE_URL}${src}`;
  return `${SITE_URL}/${src}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function fetchPost(table: string, id: string) {
  const titleField = table === 'tr_notices' ? 'title' : 'subject';
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=id,${titleField},content`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;
  const data = await response.json();
  if (!data || data.length === 0) return null;

  return {
    title: data[0][titleField] || '',
    content: data[0].content || '',
  };
}

export const config = {
  matcher: ['/reviews.html', '/reviews-book.html', '/notice.html', '/materials.html'],
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) return;

  const ua = request.headers.get('user-agent') || '';
  if (!CRAWLER_PATTERN.test(ua)) return;

  const pageName = url.pathname.replace('/', '').replace('.html', '');
  const pageConfig = PAGE_CONFIG[pageName];
  if (!pageConfig) return;

  const post = await fetchPost(pageConfig.table, id);
  if (!post) return;

  const ogTitle = escapeHtml(`${post.title} - ${pageConfig.defaultTitle}`);
  const plainText = stripHtml(post.content);
  const ogDescription = escapeHtml(
    plainText.length > 160 ? plainText.substring(0, 157) + '...' : plainText
  );
  const ogImage = escapeHtml(extractFirstImage(post.content) || FALLBACK_IMAGE);
  const ogUrl = escapeHtml(`${SITE_URL}${url.pathname}?id=${id}`);
  const redirectUrl = `${SITE_URL}${url.pathname}?id=${id}`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${ogTitle}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDescription}">
<meta property="og:url" content="${ogUrl}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDescription}">
<meta name="twitter:image" content="${ogImage}">
<meta http-equiv="refresh" content="0; url=${redirectUrl}">
</head>
<body>
<script>window.location.replace("${redirectUrl}");</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
