const ALLOWED_ORIGIN = "https://www.novawebmix.com";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function isAudioFile(name) {
  return /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(name);
}

function cleanFileName(name) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "NovaWebMix API",
        status: "online",
      });
    }

    if (!env.MY_BUCKET) {
      return json(
        {
          ok: false,
          error: "R2 não está ligado ao Worker.",
        },
        500
      );
    }

    if (url.pathname === "/api/music" && request.method === "GET") {
      const listed = await env.MY_BUCKET.list({
        prefix: "music/",
        limit: 1000,
      });

      const files = listed.objects.map((object) => ({
        key: object.key,
        name: object.key.replace(/^music\//, ""),
        size: object.size,
        uploaded: object.uploaded,
      }));

      return json({
        ok: true,
        files,
      });
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      if (env.ADMIN_KEY) {
        const key = request.headers.get("X-Admin-Key");

        if (key !== env.ADMIN_KEY) {
          return json(
            {
              ok: false,
              error: "Não autorizado.",
            },
            401
          );
        }
      }

      const form = await request.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        return json(
          {
            ok: false,
            error: "Nenhum ficheiro foi enviado.",
          },
          400
        );
      }

      if (!isAudioFile(file.name)) {
        return json(
          {
            ok: false,
            error: "Formato de áudio não suportado.",
          },
          400
        );
      }

      if (file.size > 100 * 1024 * 1024) {
        return json(
          {
            ok: false,
            error: "O ficheiro ultrapassa o limite de 100 MB.",
          },
          400
        );
      }

      const fileName = cleanFileName(file.name);
      const key = `music/${crypto.randomUUID()}-${fileName}`;

      await env.MY_BUCKET.put(key, file.stream(), {
        httpMetadata: {
          contentType: file.type || "audio/mpeg",
        },
        customMetadata: {
          originalName: file.name,
        },
      });

      return json({
        ok: true,
        key,
        name: file.name,
        size: file.size,
      });
    }

    if (url.pathname.startsWith("/api/music/")) {
      const key = decodeURIComponent(
        url.pathname.substring("/api/music/".length)
      );

      if (!key.startsWith("music/")) {
        return json(
          {
            ok: false,
            error: "Ficheiro inválido.",
          },
          400
        );
      }

      if (request.method === "GET") {
        const object = await env.MY_BUCKET.get(key);

        if (!object) {
          return new Response("Ficheiro não encontrado.", {
            status: 404,
            headers: corsHeaders(),
          });
        }

        const headers = new Headers(corsHeaders());

        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);

        return new Response(object.body, {
          headers,
        });
      }

      if (request.method === "DELETE") {
        if (env.ADMIN_KEY) {
          const adminKey = request.headers.get("X-Admin-Key");

          if (adminKey !== env.ADMIN_KEY) {
            return json(
              {
                ok: false,
                error: "Não autorizado.",
              },
              401
            );
          }
        }

        await env.MY_BUCKET.delete(key);

        return json({
          ok: true,
          deleted: key,
        });
      }
    }

    return json(
      {
        ok: false,
        error: "Rota não encontrada.",
      },
      404
    );
  },
};
