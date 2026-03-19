/** @type {import('next').NextConfig} */
const nextConfig = {
  // LIFF は CSR が必要なためSSR を部分的に無効化
  reactStrictMode: true,
};

export default nextConfig;
