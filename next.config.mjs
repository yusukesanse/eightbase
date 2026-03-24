/** @type {import('next').NextConfig} */
const nextConfig = {
  // LIFF は CSR が必要なため SSR を部分的に無効化
  reactStrictMode: true,

  // ─── セキュリティヘッダー ─────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // HTTPS 強制（本番のみ有効 / Vercel では自動的に HTTPS）
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // iframe 埋め込みを同一オリジンのみ許可
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          // MIME タイプ スニッフィングを無効化
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          // Referrer ヘッダーのポリシー
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // 不要なブラウザAPIのアクセスを制限
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // XSS フィルター（レガシーブラウザ向け）
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
