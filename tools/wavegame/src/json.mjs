const decoder = new TextDecoder('utf-8', { fatal: true });

export function decodeUtf8(bytes, label = 'JSON') {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

export function parseStrictJson(input, label = 'JSON') {
  const text = typeof input === 'string' ? input : decodeUtf8(input, label);
  const parser = new StrictJsonParser(text, label);
  return parser.parse();
}

export function canonicalJson(value) {
  assertJsonValue(value);
  return encodeCanonical(value);
}

export function jsonByteLength(value) {
  return Buffer.byteLength(canonicalJson(value));
}

export function assertJsonValue(value, label = 'value', maxDepth = 64) {
  const seen = new Set();
  const visit = (current, path, depth) => {
    if (depth > maxDepth) throw new Error(`${label}${path} exceeds JSON depth ${maxDepth}`);
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error(`${label}${path} must contain only finite numbers`);
      return;
    }
    if (typeof current !== 'object') throw new Error(`${label}${path} is not JSON-compatible`);
    if (seen.has(current)) throw new Error(`${label}${path} contains a cycle`);
    seen.add(current);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], `${path}[${index}]`, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label}${path} contains a non-plain object`);
      }
      for (const key of Object.keys(current)) {
        visit(current[key], `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(current);
  };
  visit(value, '', 0);
}

function encodeCanonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encodeCanonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key])}`).join(',')}}`;
}

class StrictJsonParser {
  constructor(text, label) {
    this.text = text;
    this.label = label;
    this.position = 0;
    this.depth = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.position !== this.text.length) this.fail('has trailing content');
    return value;
  }

  parseValue() {
    const character = this.text[this.position];
    if (character === '{') return this.parseObject();
    if (character === '[') return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === 't') return this.parseLiteral('true', true);
    if (character === 'f') return this.parseLiteral('false', false);
    if (character === 'n') return this.parseLiteral('null', null);
    if (character === '-' || (character >= '0' && character <= '9')) return this.parseNumber();
    this.fail('contains an invalid value');
  }

  parseObject() {
    this.enterContainer();
    this.position += 1;
    const result = Object.create(null);
    const keys = new Set();
    this.skipWhitespace();
    if (this.text[this.position] === '}') {
      this.position += 1;
      this.leaveContainer();
      return result;
    }
    while (true) {
      if (this.text[this.position] !== '"') this.fail('object key must be a string');
      const key = this.parseString();
      if (keys.has(key)) this.fail(`contains duplicate key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.position] !== ':') this.fail('object key is missing a colon');
      this.position += 1;
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      const character = this.text[this.position];
      if (character === '}') {
        this.position += 1;
        this.leaveContainer();
        return result;
      }
      if (character !== ',') this.fail('object entries must be comma-separated');
      this.position += 1;
      this.skipWhitespace();
    }
  }

  parseArray() {
    this.enterContainer();
    this.position += 1;
    const result = [];
    this.skipWhitespace();
    if (this.text[this.position] === ']') {
      this.position += 1;
      this.leaveContainer();
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const character = this.text[this.position];
      if (character === ']') {
        this.position += 1;
        this.leaveContainer();
        return result;
      }
      if (character !== ',') this.fail('array entries must be comma-separated');
      this.position += 1;
      this.skipWhitespace();
    }
  }

  parseString() {
    const start = this.position;
    this.position += 1;
    while (this.position < this.text.length) {
      const code = this.text.charCodeAt(this.position);
      if (code === 0x22) {
        this.position += 1;
        try {
          return JSON.parse(this.text.slice(start, this.position));
        } catch {
          this.fail('contains an invalid string');
        }
      }
      if (code < 0x20) this.fail('contains an unescaped control character');
      if (code === 0x5c) {
        this.position += 1;
        const escape = this.text[this.position];
        if (!'"\\/bfnrtu'.includes(escape ?? '')) this.fail('contains an invalid escape');
        if (escape === 'u') {
          const digits = this.text.slice(this.position + 1, this.position + 5);
          if (!/^[0-9A-Fa-f]{4}$/.test(digits)) this.fail('contains an invalid Unicode escape');
          this.position += 4;
        }
      }
      this.position += 1;
    }
    this.fail('contains an unterminated string');
  }

  parseNumber() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.text.slice(this.position),
    );
    if (!match) this.fail('contains an invalid number');
    this.position += match[0].length;
    const token = match[0];
    const value = Number(token);
    if (!Number.isFinite(value)) this.fail('contains a non-finite number');
    if (/[.eE]/.test(token)) return new JsonNonInteger(value);
    if (!Number.isSafeInteger(value)) this.fail('contains an integer outside the safe metadata range');
    return value;
  }

  parseLiteral(token, value) {
    if (!this.text.startsWith(token, this.position)) this.fail(`contains invalid token ${token}`);
    this.position += token.length;
    return value;
  }

  skipWhitespace() {
    while (/\s/.test(this.text[this.position] ?? '') && this.position < this.text.length) {
      const character = this.text[this.position];
      if (character !== ' ' && character !== '\n' && character !== '\r' && character !== '\t') {
        this.fail('contains non-JSON whitespace');
      }
      this.position += 1;
    }
  }

  enterContainer() {
    this.depth += 1;
    if (this.depth > 32) this.fail('exceeds JSON depth 32');
  }

  leaveContainer() {
    this.depth -= 1;
  }

  fail(message) {
    throw new Error(`${this.label} ${message} at byte ${Buffer.byteLength(this.text.slice(0, this.position))}`);
  }
}

class JsonNonInteger {
  constructor(value) {
    this.value = value;
  }
}
