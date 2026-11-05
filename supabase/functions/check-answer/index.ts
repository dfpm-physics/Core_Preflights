import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handle } from "./handler.js";

// check-answer — takes ONE answer to ONE auto-checked question and returns right or wrong, nothing else.
// All the logic is in handler.js (tested offline); this file only builds the two clients.
//
// NOT DEPLOYED. Deploying needs: migrations app/070 and app/071 applied, this folder added to DEPLOYABLE in
// scripts/staging/deploy_functions.py (verify_jwt true), and the Stage E gate run on staging.
//
// The service-role client is used for exactly two database functions, answer_context and record_answer, whose
// execute grant is service_role only. It never reads a table.

serve((req: Request) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "app" }, auth: { persistSession: false } },
  );
  return handle(req, {
    getUser: async (jwt: string) => {
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data?.user ? null : { id: data.user.id };
    },
    rpc: (name: string, args: Record<string, unknown>) => admin.rpc(name, args),
  });
});
