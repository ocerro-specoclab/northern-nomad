import { createClient } from "@supabase/supabase-js";

// Estas dos variables las defines en Vercel (y en .env.local para desarrollo).
// NUNCA pongas las claves directamente en el código que subes a un repo público.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

// Identificador fijo de tu cartera personal (sin login, un solo usuario).
export const OWNER = "personal";
