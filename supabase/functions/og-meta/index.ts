// ===== OG Meta Tag Edge Function =====
// 동적 페이지(후기, 공지, 학습자료)의 개별 글 공유 시
// 카카오톡/네이버 등 크롤러에게 올바른 OG 메타태그를 제공합니다.
//
// 사용법: 각 HTML 페이지에서 ?id= 파라미터가 있을 때
// 이 Edge Function으로 리다이렉트하면, 크롤러에게는 OG 메타태그가 담긴 HTML을,
// 일반 사용자에게는 원래 페이지로 즉시 이동시킵니다.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE_URL = "https://eonfl.com";
const SITE_NAME = "이온토플";
const FALLBACK_IMAGE = `${SITE_URL}/logo/og-default.png`;

// 페이지별 설정: HTML 파일명 → DB 테이블명 + 기본 제목
const PAGE_CONFIG: Record<string, { table: string; defaultTitle: string }> = {
  "reviews": { table: "reviews", defaultTitle: "후기 - 이온토플" },
  "reviews-book": { table: "reviews_book", defaultTitle: "입문서 후기 - 이온토플" },
  "notice": { table: "tr_notices", defaultTitle: "공지사항 - 이온토플" },
  "materials": { table: "materials", defaultTitle: "학습 자료 - 이온토플" },
};

// HTML 콘텐츠에서 순수 텍스트 추출 (태그 제거)
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// HTML 콘텐츠에서 첫 번째 이미지 URL 추출
function extractFirstImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!match) return null;
  const src = match[1];
  // data: URI 무시
  if (src.startsWith("data:")) return null;
  // 이미 절대경로
  if (src.startsWith("http")) return src;
  // 상대경로 → 절대경로
  if (src.startsWith("/")) return `${SITE_URL}${src}`;
  return `${SITE_URL}/${src}`;
}

// 특수문자 이스케이프
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Supabase에서 데이터 가져오기
async function fetchPost(table: string, id: string) {
  // tr_notices 테이블의 경우 title 필드를 사용, 나머지는 subject 필드
  const titleField = table === "tr_notices" ? "title" : "subject";
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=id,${titleField},content`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (!data || data.length === 0) return null;

  const post = data[0];
  return {
    title: post[titleField] || post.subject || post.title || "",
    content: post.content || "",
  };
}

// OG 메타태그가 포함된 HTML 생성
function buildOgHtml(
  title: string,
  description: string,
  url: string,
  image: string,
  redirectUrl: string
): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = escapeHtml(image);
  const r = escapeHtml(redirectUrl);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${t}</title>

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
<meta property="og:image" content="${img}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">

<!-- 일반 사용자는 원래 페이지로 즉시 이동 -->
<meta http-equiv="refresh" content="0; url=${r}">
<link rel="canonical" href="${u}">
</head>
<body>
<p>잠시 후 <a href="${r}">${t}</a> 페이지로 이동합니다.</p>
<script>window.location.replace("${redirectUrl}");</script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  // CORS 처리
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const url = new URL(req.url);
  const page = url.searchParams.get("page");
  const id = url.searchParams.get("id");

  // 필수 파라미터 확인
  if (!page || !id) {
    return new Response("Missing page or id parameter", { status: 400 });
  }

  // 페이지 설정 확인
  const config = PAGE_CONFIG[page];
  if (!config) {
    return new Response(`Unknown page: ${page}`, { status: 400 });
  }

  // 원래 페이지 URL (사용자가 최종적으로 볼 페이지)
  const originalUrl = `${SITE_URL}/${page}.html?id=${id}`;

  // DB에서 글 데이터 가져오기
  const post = await fetchPost(config.table, id);

  if (!post) {
    // 글을 못 찾으면 원래 페이지로 리다이렉트
    return Response.redirect(originalUrl, 302);
  }

  // OG 데이터 구성
  const ogTitle = `${post.title} - ${config.defaultTitle}`;

  const plainText = stripHtml(post.content);
  const ogDescription =
    plainText.length > 160 ? plainText.substring(0, 157) + "..." : plainText;

  const ogImage = extractFirstImage(post.content) || FALLBACK_IMAGE;

  // OG HTML 반환
  const html = buildOgHtml(ogTitle, ogDescription, originalUrl, ogImage, originalUrl);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300", // 5분 캐시
    },
  });
});
