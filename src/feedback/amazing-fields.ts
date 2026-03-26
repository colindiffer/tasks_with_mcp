interface AmazingFieldOption {
  id: string;
  text: string;
}

interface AmazingFieldConfigField {
  id: string;
  name: string;
  type: string;
  options?: AmazingFieldOption[];
}

interface AmazingFieldsBoardConfig {
  fields: AmazingFieldConfigField[];
}

function decompressFromUTF16(compressed: string | undefined): string | null {
  if (compressed == null) return '';
  if (compressed === '') return null;
  return decompress(compressed.length, 16384, index => compressed.charCodeAt(index) - 32);
}

function decompress(length: number, resetValue: number, getNextValue: (index: number) => number): string | null {
  const dictionary: Array<string | number> = [];
  let next: number;
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = '';
  const result: string[] = [];
  let i: number;
  let w: string;
  let bits: number;
  let resb: number;
  let maxpower: number;
  let power: number;
  let c: string | number;

  const data = { val: getNextValue(0), position: resetValue, index: 1 };
  for (i = 0; i < 3; i += 1) dictionary[i] = i;

  bits = 0;
  maxpower = 4;
  power = 1;
  while (power !== maxpower) {
    resb = data.val & data.position;
    data.position >>= 1;
    if (data.position === 0) {
      data.position = resetValue;
      data.val = getNextValue(data.index++);
    }
    bits |= (resb > 0 ? 1 : 0) * power;
    power <<= 1;
  }

  switch (next = bits) {
    case 0:
      bits = 0;
      maxpower = 256;
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      c = String.fromCharCode(bits);
      break;
    case 1:
      bits = 0;
      maxpower = 65536;
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      c = String.fromCharCode(bits);
      break;
    case 2:
      return '';
    default:
      return '';
  }

  dictionary[3] = c;
  w = String(c);
  result.push(w);

  while (true) {
    if (data.index > length) return '';
    bits = 0;
    maxpower = Math.pow(2, numBits);
    power = 1;

    while (power !== maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    switch (c = bits) {
      case 0:
        bits = 0;
        maxpower = 256;
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[dictSize++] = String.fromCharCode(bits);
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        bits = 0;
        maxpower = 65536;
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[dictSize++] = String.fromCharCode(bits);
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
      default:
        break;
    }

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }

    let value: string;
    if (dictionary[c]) {
      value = String(dictionary[c]);
    } else if (c === dictSize) {
      value = w + w.charAt(0);
    } else {
      return null;
    }

    result.push(value);
    dictionary[dictSize++] = w + value.charAt(0);
    enlargeIn--;
    w = value;

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
}

function parseCompressedValue<T>(compressed: string | undefined): T | null {
  const decompressed = decompressFromUTF16(compressed);
  if (!decompressed) return null;
  try {
    return JSON.parse(decompressed) as T;
  } catch {
    return null;
  }
}

export function decodeBoardConfig(pluginValue: string | undefined): AmazingFieldsBoardConfig | null {
  if (!pluginValue) return null;
  try {
    const outer = JSON.parse(pluginValue) as { CFG?: string };
    return parseCompressedValue<AmazingFieldsBoardConfig>(outer.CFG);
  } catch {
    return null;
  }
}

export function decodeCardFieldValues(
  pluginValue: string | undefined,
  boardConfig: AmazingFieldsBoardConfig | null
): Record<string, string> {
  if (!pluginValue || !boardConfig) return {};

  let outer: { FD?: string };
  try {
    outer = JSON.parse(pluginValue) as { FD?: string };
  } catch {
    return {};
  }

  const decoded = parseCompressedValue<Record<string, unknown>>(outer.FD);
  if (!decoded) return {};

  const values: Record<string, string> = {};

  for (const field of boardConfig.fields) {
    const raw = decoded[field.id];
    if (raw == null) continue;

    if (typeof raw === 'string') {
      const optionText = field.options?.find(option => option.id === raw)?.text;
      values[field.name] = optionText ?? raw;
      continue;
    }

    if (Array.isArray(raw)) {
      const mapped = raw
        .map(item => typeof item === 'string'
          ? field.options?.find(option => option.id === item)?.text ?? item
          : '')
        .filter(Boolean);
      if (mapped.length > 0) values[field.name] = mapped.join(', ');
      continue;
    }

    if (typeof raw === 'object') {
      const objectValue = raw as { id?: string; value?: string; text?: string };
      const optionText = objectValue.id
        ? field.options?.find(option => option.id === objectValue.id)?.text
        : undefined;
      values[field.name] = optionText ?? objectValue.text ?? objectValue.value ?? '';
    }
  }

  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}
