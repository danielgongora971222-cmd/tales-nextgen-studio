export default {
  async rewrites() {
    const origin = process.env.API_ORIGIN;
    return [
      { source: "/api/:path*", destination: `${origin}/api/:path*` },
    ];
  },
};
