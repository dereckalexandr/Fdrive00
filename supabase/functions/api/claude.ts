// Llamadas a Claude (API de Anthropic) con el SDK oficial. Lo usa el asistente de WhatsApp (wa-ia.ts).
// La clave se carga como secreto en Supabase (ANTHROPIC_API_KEY); sin ella la IA queda apagada y el asistente de menú sigue igual.
// Opcional: ANTHROPIC_MODEL_WA para cambiar el modelo (por defecto claude-haiku-5-5).
// El SDK se carga recién en la primera llamada (import dinámico): casi ningún arranque del servidor lo necesita y así el arranque en frío es más corto.

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
export const claudeConfigurado = () => !!env("ANTHROPIC_API_KEY");
export const modeloClaude = () => env("ANTHROPIC_MODEL_WA") || "claude-haiku-5-5";

let cliente: any = null;
/** Una llamada a la API de mensajes. Lanza si falta la clave o la API responde con error (el que llama decide qué hacer). */
export async function llamarClaude(params: any): Promise<any> {
  if (!claudeConfigurado()) throw new Error("Falta ANTHROPIC_API_KEY");
  // Un reintento y 25 s de espera: Meta reenvía el aviso si el servidor tarda demasiado.
  if (!cliente) {
    const { default: Anthropic } = await import("npm:@anthropic-ai/sdk@1.14.0");
    cliente = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 1, timeout: 25_000 });
  }
  return await cliente.messages.create(params);
}
