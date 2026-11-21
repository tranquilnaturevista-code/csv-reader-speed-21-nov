// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the
// same {text, header}: {columns, rows, errors}. The reading policy, in short:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and an
// empty line is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field opening with a quote runs to the next undoubled quote,
// "" inside it is one quote and each CRLF or lone CR inside it reads as LF,
// what follows the closing quote up to the next comma or line break is
// appended as it stands (quote_junk when the field ends); a quote that never
// closes is a literal character and the text after it is read again as
// unquoted (unterminated_quote); a quote inside an unquoted field is literal.
// columns is the first record when header is true, else null; rows are the
// records after it, each padded (short_row) or cut (long_row) to the first
// record's width. Each error is {code, line, row} in the order met, with line
// the 1-based line its record starts on and row its index in rows (null for
// the header).
//
// Speed: the reference walks the text one character at a time and builds
// every field by appending one character at a time. This parser instead jumps
// from one significant character to the next with indexOf (which V8 runs over
// the string directly) and cuts each field's kept pieces out with slice. Every
// search is bounded by the piece it can end — the next comma for an unquoted
// field, the next quote for a quoted one — so no scan ever runs past the
// field it belongs to. A record whose line holds no quote at all is split in
// one native call, and the common unquoted field is read inline in the record
// loop, with no function call per field. No regular expressions, no network,
// no dependencies, nothing kept from one call to the next.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end. */
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  const hasCR = text.indexOf('\r') !== -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null while it is the header). Errors report these, not the line the
  // reader has reached inside the record.
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The field just read by the quoted reader: its value, how it ended, and
  // how many characters were kept onto its starting value (only the junk
  // check reads the last one). The unquoted reader below is inlined in the
  // record loop and keeps its result in locals instead.
  let fValue = '';
  let fEnded = AT_END;
  let fAdded = 0;

  // Reads unquoted characters onto `prefix` up to the next comma, line
  // break or the end of the text. A CR not followed by LF is dropped and
  // recorded; anything else is kept as it stands. Used only where a quoted
  // field is re-read (unterminated) or continued (junk); plain unquoted
  // fields take the inlined copy in the record loop.
  function readUnquoted(prefix) {
    let added = 0;
    let acc = prefix;
    let p = pos;
    for (;;) {
      // The piece up to the next comma holds no comma; only a line break
      // or a CR inside it can end or split the field before the comma.
      const mComma = text.indexOf(',', p);
      const end = mComma === -1 ? n : mComma;
      const piece = text.slice(p, end);
      const kLF = piece.indexOf('\n');
      const kCR = hasCR ? piece.indexOf('\r') : -1;
      if (kLF === -1 && kCR === -1) {
        if (piece.length) {
          added += piece.length;
          acc += piece;
        }
        if (mComma === -1) {
          pos = n;
          fValue = acc;
          fEnded = AT_END;
          fAdded = added;
          return;
        }
        pos = mComma + 1;
        fValue = acc;
        fEnded = AT_COMMA;
        fAdded = added;
        return;
      }
      if (kCR !== -1 && (kLF === -1 || kCR < kLF)) {
        if (kCR + 1 < piece.length && piece.charCodeAt(kCR + 1) === 10) {
          // CRLF: one line break, the CR is not part of the field.
          if (kCR > 0) {
            added += kCR;
            acc += piece.slice(0, kCR);
          }
          pos = p + kCR + 2;
          line += 1;
          fValue = acc;
          fEnded = AT_BREAK;
          fAdded = added;
          return;
        }
        // A stray CR: drop it, record it, read on past it. (A CR as the
        // piece's last character is stray too: the next character is the
        // comma, or there is none.)
        error('stray_cr');
        if (kCR > 0) {
          added += kCR;
          acc += piece.slice(0, kCR);
        }
        p = p + kCR + 1;
        continue;
      }
      // An LF before any CR: the field ends here.
      if (kLF > 0) {
        added += kLF;
        acc += piece.slice(0, kLF);
      }
      pos = p + kLF + 1;
      line += 1;
      fValue = acc;
      fEnded = AT_BREAK;
      fAdded = added;
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let acc = '';
    pos += 1; // past the opening quote
    for (;;) {
      const iQuote = text.indexOf('"', pos);
      if (iQuote === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted, from the line it opened on.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      // The piece up to the next quote: only a line break or a CR inside
      // it matters before that quote.
      const piece = text.slice(pos, iQuote);
      const kLF = piece.indexOf('\n');
      const kCR = hasCR ? piece.indexOf('\r') : -1;
      if (kLF === -1 && kCR === -1) {
        if (text.charCodeAt(iQuote + 1) === 34) {
          // A doubled quote is one quote in the value.
          acc += piece + '"';
          pos = iQuote + 2;
          continue;
        }
        acc += piece;
        pos = iQuote + 1;
        if (pos >= n) {
          fValue = acc;
          fEnded = AT_END;
          fAdded = 0;
          return;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fValue = acc;
          fEnded = AT_COMMA;
          fAdded = 0;
          return;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fValue = acc;
          fEnded = AT_BREAK;
          fAdded = 0;
          return;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fValue = acc;
          fEnded = AT_BREAK;
          fAdded = 0;
          return;
        }
        // What follows the closing quote is appended as it stands, up to
        // the next comma or line break.
        readUnquoted(acc);
        if (fAdded > 0) error('quote_junk');
        return;
      }
      if (kCR !== -1 && (kLF === -1 || kCR < kLF)) {
        // A CR (or CRLF) inside quotes reads as one LF.
        if (kCR > 0) acc += piece.slice(0, kCR);
        acc += '\n';
        line += 1;
        pos = pos + kCR + 1;
        if (text.charCodeAt(pos) === 10) pos += 1;
        continue;
      }
      // An LF inside quotes is kept and counts a line.
      acc += piece.slice(0, kLF + 1);
      line += 1;
      pos = pos + kLF + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields = null;
    let quoted = false;
    // A record whose line holds no quote at all: no field opens with one,
    // so the whole line splits at its commas in one call. A stray CR, or a
    // CR at the end of a line that runs to the end of the text, falls back
    // to the field-by-field reader below.
    const iLF = text.indexOf('\n', pos);
    const lineEnd = iLF === -1 ? n : iLF;
    if (lineEnd > pos) {
      let body = text.slice(pos, lineEnd);
      if (iLF !== -1 && body.charCodeAt(body.length - 1) === 13) body = body.slice(0, -1);
      if (body.indexOf('"') === -1 && body.indexOf('\r') === -1) {
        fields = body.split(',');
        pos = lineEnd + (iLF === -1 ? 0 : 1);
        if (iLF !== -1) line += 1;
      }
    }
    if (fields === null) {
      fields = [];
      let ended = AT_END;
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) {
          readQuoted();
          fields.push(fValue);
          ended = fEnded;
        } else {
          // An unquoted field, read inline: the piece up to the next comma
          // holds no comma, so only a line break or a CR inside it can end
          // or split the field before the comma.
          let acc = '';
          let p = pos;
          for (;;) {
            const mComma = text.indexOf(',', p);
            const end = mComma === -1 ? n : mComma;
            const piece = text.slice(p, end);
            const kLF = piece.indexOf('\n');
            const kCR = hasCR ? piece.indexOf('\r') : -1;
            if (kLF === -1 && kCR === -1) {
              if (piece.length) acc += piece;
              if (mComma === -1) {
                pos = n;
                ended = AT_END;
              } else {
                pos = mComma + 1;
                ended = AT_COMMA;
              }
              break;
            }
            if (kCR !== -1 && (kLF === -1 || kCR < kLF)) {
              if (kCR + 1 < piece.length && piece.charCodeAt(kCR + 1) === 10) {
                // CRLF: one line break, the CR is not part of the field.
                if (kCR > 0) acc += piece.slice(0, kCR);
                pos = p + kCR + 2;
                line += 1;
                ended = AT_BREAK;
                break;
              }
              // A stray CR: drop it, record it, read on past it.
              error('stray_cr');
              if (kCR > 0) acc += piece.slice(0, kCR);
              p = p + kCR + 1;
              continue;
            }
            // An LF before any CR: the field ends here.
            if (kLF > 0) acc += piece.slice(0, kLF);
            pos = p + kLF + 1;
            line += 1;
            ended = AT_BREAK;
            break;
          }
          fields.push(acc);
        }
      } while (ended === AT_COMMA);
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
