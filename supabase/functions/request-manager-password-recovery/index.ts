const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({
    message: "بازیابی ایمیلی غیرفعال شده است. برای بازنشانی رمز، مدیر کل باید از پنل مدیریت کل اقدام کند.",
  }), {
    status: 410,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
