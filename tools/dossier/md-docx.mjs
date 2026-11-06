/**
 * md-docx.mjs — schmaler Markdown → docx-Wandler für den Abschnitt
 * „AI Research" im Dossier.
 *
 * Deckt genau das ab, was die Recherche-Prompts ausgeben (siehe Format-Block in
 * ui/lib/research-prompt.js): Überschriften (#…####), fette Zwischenzeilen,
 * Aufzählungen mit Einrückung (- / * / 1.), **fett**, *kursiv*, [Text](URL)
 * und nackte URLs als Links, Signal-Marker 🔴🟢🟡⚪ als normaler Text. Tabellen
 * bleiben als Textzeilen stehen — lieber lesbar als falsch gesetzt.
 */

import { Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';

const HEADINGS = [HeadingLevel.HEADING_3, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_4];

// Inline: **fett**, *kursiv* / _kursiv_, [Text](URL), nackte URL.
const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>()\]]+|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<!\w)_[^_\s][^_]*_(?!\w))/g;

export function inlineRuns(text, base = {}) {
  const out = [];
  let last = 0;
  const s = String(text ?? '');
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(new TextRun({ text: s.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) {
      out.push(...inlineRuns(t.slice(2, -2), { ...base, bold: true }));
    } else if (t.startsWith('[')) {
      const label = t.slice(1, t.indexOf(']('));
      out.push(new ExternalHyperlink({ link: m[2], children: [new TextRun({ text: label, style: 'Hyperlink', ...base })] }));
    } else if (t.startsWith('http')) {
      const url = t.replace(/[.,;:]+$/, '');
      out.push(new ExternalHyperlink({ link: url, children: [new TextRun({ text: url, style: 'Hyperlink', ...base })] }));
      if (url.length < t.length) out.push(new TextRun({ text: t.slice(url.length), ...base }));
    } else {
      out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    }
    last = m.index + t.length;
  }
  if (last < s.length) out.push(new TextRun({ text: s.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

/** Markdown → Paragraph[] */
export function markdownToParagraphs(md) {
  const out = [];
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;           // Trennlinie
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue; // Tabellen-Trennzeile
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      out.push(new Paragraph({ heading: HEADINGS[m[1].length - 1], children: inlineRuns(m[2].replace(/\*\*/g, '')) }));
      continue;
    }
    if ((m = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/.exec(line))) {
      const level = Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
      if (/\d/.test(m[2])) out.push(new Paragraph({ indent: { left: 360 * (level + 1), hanging: 260 }, children: inlineRuns(`${m[2]} ${m[3]}`) }));
      else out.push(new Paragraph({ bullet: { level }, children: inlineRuns(m[3]) }));
      continue;
    }
    if ((m = /^\*\*([^*]+)\*\*:?$/.exec(line.trim()))) {                 // fette Zwischenzeile
      out.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: m[1], bold: true })] }));
      continue;
    }
    out.push(new Paragraph({ children: inlineRuns(line.trim()) }));
  }
  return out;
}
