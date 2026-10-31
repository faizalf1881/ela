/**
 * WhatsApp template helpers shared by the browser (picker, preview, campaign
 * mapping) and the server (building what is sent). Pure — no I/O.
 *
 * Templates come from Meta as components: HEADER (text with ≤1 variable, or
 * image/video/document), BODY ({{1}} positional or {{first_name}} named
 * variables), FOOTER, BUTTONS (quick reply, URL with a dynamic suffix, phone,
 * copy code…). Sending means supplying a value for every variable.
 */

export type TplButton = { type: string; text?: string; url?: string; phone_number?: string; example?: string[] | string };
export type TplComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: TplButton[];
  example?: {
    header_text?: string[];
    header_text_named_params?: { param_name: string; example: string }[];
    body_text?: string[][];
    body_text_named_params?: { param_name: string; example: string }[];
    header_handle?: string[];
  };
};
export type TemplateLike = { name: string; language: string; category: string; parameterFormat: string; components: unknown };

export type TplVar = {
  /** "header", "header_media", "body:1", "body:first_name", "button:1" */
  key: string;
  part: "header" | "header_media" | "body" | "button";
  name: string;
  label: string;
  kind: "text" | "media" | "url_suffix" | "coupon";
  mediaType?: "image" | "video" | "document";
  example?: string;
  maxLength: number;
};

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function comps(t: TemplateLike): TplComponent[] {
  return Array.isArray(t.components) ? (t.components as TplComponent[]) : [];
}
function varsIn(text: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  // Positional variables are filled in number order.
  return out.every((v) => /^\d+$/.test(v)) ? out.sort((a, b) => Number(a) - Number(b)) : out;
}
const pretty = (name: string) => (/^\d+$/.test(name) ? `{{${name}}}` : name.replace(/_/g, " "));

/** Why this template can't be sent from the admin panel (null = it can). */
export function unsupportedReason(t: TemplateLike): string | null {
  for (const c of comps(t)) {
    const type = c.type?.toUpperCase();
    if (type === "CAROUSEL" || type === "LIMITED_TIME_OFFER") return `${type.toLowerCase().replace(/_/g, " ")} templates can only be sent from WhatsApp Manager`;
    if (type === "HEADER" && c.format && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(c.format.toUpperCase())) return `${c.format.toLowerCase()} headers aren't supported here`;
    if (type === "BUTTONS") {
      const bad = (c.buttons ?? []).find((b) => !["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE"].includes((b.type || "").toUpperCase()));
      if (bad) return `${(bad.type || "this").toLowerCase().replace(/_/g, " ")} buttons aren't supported here`;
    }
  }
  if (t.category?.toUpperCase() === "AUTHENTICATION") return "Authentication (OTP) templates are only used for logins";
  return null;
}

/** Everything a person has to fill in before this template can be sent. */
export function templateVariables(t: TemplateLike): TplVar[] {
  const out: TplVar[] = [];
  for (const c of comps(t)) {
    const type = c.type?.toUpperCase();
    if (type === "HEADER") {
      const format = (c.format || "TEXT").toUpperCase();
      if (format === "TEXT") {
        const v = varsIn(c.text)[0];
        if (v) {
          const named = c.example?.header_text_named_params?.find((p) => p.param_name === v)?.example;
          out.push({ key: "header", part: "header", name: v, label: `Heading ${pretty(v)}`, kind: "text", example: named ?? c.example?.header_text?.[0], maxLength: 60 });
        }
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
        const mediaType = format.toLowerCase() as "image" | "video" | "document";
        out.push({ key: "header_media", part: "header_media", name: "media", label: `${format[0]}${format.slice(1).toLowerCase()} link (https://…)`, kind: "media", mediaType, maxLength: 1000 });
      }
    } else if (type === "BODY") {
      const vars = varsIn(c.text);
      vars.forEach((v, i) => {
        const named = c.example?.body_text_named_params?.find((p) => p.param_name === v)?.example;
        out.push({ key: `body:${v}`, part: "body", name: v, label: pretty(v), kind: "text", example: named ?? c.example?.body_text?.[0]?.[i], maxLength: 1000 });
      });
    } else if (type === "BUTTONS") {
      (c.buttons ?? []).forEach((b, i) => {
        const bt = (b.type || "").toUpperCase();
        if (bt === "URL" && varsIn(b.url).length) {
          const ex = Array.isArray(b.example) ? b.example[0] : b.example;
          out.push({ key: `button:${i}`, part: "button", name: String(i), label: `"${b.text}" button link ending`, kind: "url_suffix", example: ex, maxLength: 1000 });
        } else if (bt === "COPY_CODE") {
          const ex = Array.isArray(b.example) ? b.example[0] : b.example;
          out.push({ key: `button:${i}`, part: "button", name: String(i), label: "Coupon code to copy", kind: "coupon", example: ex, maxLength: 20 });
        }
      });
    }
  }
  return out;
}

/** Template variables may not contain new lines, tabs or long runs of spaces. */
export function cleanParam(text: string, max = 1000): string {
  return (text ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, max);
}

const fill = (text: string | undefined, part: "header" | "body", values: Record<string, string>) =>
  (text ?? "").replace(VAR_RE, (m, name: string) => {
    const v = values[part === "header" ? "header" : `body:${name}`];
    return v && v.trim() ? cleanParam(v) : m;
  });

export type TemplatePreview = {
  header: { kind: "text"; text: string } | { kind: "media"; mediaType: string; url: string | null } | null;
  body: string;
  footer: string | null;
  buttons: { type: string; text: string; url?: string }[];
};

/** What the customer will see, with the values filled in ({{…}} where still empty). */
export function renderPreview(t: TemplateLike, values: Record<string, string>): TemplatePreview {
  const p: TemplatePreview = { header: null, body: "", footer: null, buttons: [] };
  for (const c of comps(t)) {
    const type = c.type?.toUpperCase();
    if (type === "HEADER") {
      const format = (c.format || "TEXT").toUpperCase();
      p.header = format === "TEXT" ? { kind: "text", text: fill(c.text, "header", values) } : { kind: "media", mediaType: format.toLowerCase(), url: values.header_media?.trim() || null };
    } else if (type === "BODY") p.body = fill(c.text, "body", values);
    else if (type === "FOOTER") p.footer = c.text ?? null;
    else if (type === "BUTTONS") {
      p.buttons = (c.buttons ?? []).map((b, i) => ({
        type: (b.type || "").toUpperCase(),
        text: (b.type || "").toUpperCase() === "COPY_CODE" ? `Copy code${values[`button:${i}`] ? ` ${values[`button:${i}`]}` : ""}` : b.text || "",
        url: b.url ? b.url.replace(VAR_RE, () => values[`button:${i}`]?.trim() || "{{1}}") : undefined,
      }));
    }
  }
  return p;
}

/** One line of text for threads and logs. */
export function previewText(p: TemplatePreview): string {
  return [p.header?.kind === "text" ? p.header.text : p.header ? `[${p.header.mediaType}]` : "", p.body, p.footer ?? "", p.buttons.length ? p.buttons.map((b) => `[${b.text}]`).join(" ") : ""]
    .filter(Boolean)
    .join("\n");
}

/**
 * The `components` WhatsApp needs to send this template, or the variables
 * still missing. Values are cleaned to WhatsApp's rules first.
 */
export function buildComponents(t: TemplateLike, values: Record<string, string>): { ok: true; components: unknown[] } | { ok: false; missing: TplVar[]; invalid?: string } {
  const vars = templateVariables(t);
  const missing = vars.filter((v) => !values[v.key]?.trim());
  if (missing.length) return { ok: false, missing };
  const named = t.parameterFormat?.toUpperCase() === "NAMED";
  const components: unknown[] = [];

  const header = vars.find((v) => v.part === "header");
  const media = vars.find((v) => v.part === "header_media");
  if (media) {
    const url = values[media.key].trim();
    if (!/^https:\/\/\S+$/i.test(url)) return { ok: false, missing: [], invalid: "The header media must be a public https:// link." };
    components.push({ type: "header", parameters: [{ type: media.mediaType, [media.mediaType!]: { link: url } }] });
  } else if (header) {
    components.push({ type: "header", parameters: [{ type: "text", text: cleanParam(values.header, 60), ...(named ? { parameter_name: header.name } : {}) }] });
  }

  const body = vars.filter((v) => v.part === "body");
  if (body.length) {
    components.push({ type: "body", parameters: body.map((v) => ({ type: "text", text: cleanParam(values[v.key], v.maxLength), ...(named ? { parameter_name: v.name } : {}) })) });
  }

  for (const v of vars.filter((x) => x.part === "button")) {
    const index = Number(v.name);
    if (v.kind === "coupon") components.push({ type: "button", sub_type: "copy_code", index, parameters: [{ type: "coupon_code", coupon_code: cleanParam(values[v.key], 20) }] });
    else components.push({ type: "button", sub_type: "url", index, parameters: [{ type: "text", text: encodeURI(cleanParam(values[v.key])) }] });
  }
  return { ok: true, components };
}
