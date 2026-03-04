import express from "express";
import { z } from "zod";

export function createLegalRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  const AcceptSchema = z.object({
    termsVersion: z.string().min(1),
    privacyVersion: z.string().min(1),
    autopayVersion: z.string().min(1),
  });

  router.post("/legal/accept", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const parsed = AcceptSchema.safeParse(req.body);
    if (!parsed.success) return err(res, 400, "BAD_REQUEST", "Payload inválido.", parsed.error.format());

    const { termsVersion, privacyVersion, autopayVersion } = parsed.data;

    const { data, error: upErr } = await supabaseAdmin
      .from("legal_acceptances")
      .upsert(
        {
          user_id: user.id,
          terms_version: termsVersion,
          privacy_version: privacyVersion,
          autopay_version: autopayVersion,
          accepted_at: new Date().toISOString(),
        },
        { onConflict: "user_id,terms_version,privacy_version,autopay_version" }
      )
      .select("id, accepted_at, terms_version, privacy_version, autopay_version")
      .maybeSingle();

    if (upErr) return err(res, 500, "DB_UPSERT_FAILED", upErr.message);

    return res.json({ ok: true, acceptance: data });
  });

  return router;
}