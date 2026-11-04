export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/test") {
      return new Response("Gold Signal Bot is ready.");
    }

    if (url.searchParams.get("key") !== env.TEST_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const response = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text: "اتصال ربات سیگنال طلا موفق بود!"
        })
      }
    );

    return Response.json(await response.json());
  }
};
