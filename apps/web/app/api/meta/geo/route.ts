/**
 * The visitor's country as Vercel's edge sees it, so the ad cookie banner knows
 * whether it has to ask first (EU, EEA, UK, Switzerland). Null off Vercel
 * (local dev), which the banner treats as "ask".
 */
export function GET(req: Request) {
  const country = req.headers.get('x-vercel-ip-country');
  return Response.json(
    { country: country && /^[A-Z]{2}$/.test(country) ? country : null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
