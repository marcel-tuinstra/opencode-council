const normalizePolicyPathValue = (value: string): string => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");

export const normalizePathList = (values?: readonly string[]): readonly string[] => {
  if (!values) {
    return [];
  }

  const normalized = values
    .map((value) => normalizePolicyPathValue(value).trim())
    .filter(Boolean);

  return Object.freeze([...new Set(normalized)]);
};

export const normalizePathPrefixList = (values?: readonly string[]): readonly string[] => {
  if (!values) {
    return [];
  }

  const normalized = values.map((value) => normalizePolicyPathValue(value).replace(/\/+$/, ""));

  return Object.freeze([...new Set(normalized)]);
};

export const pathMatchesPolicyPrefix = (path: string, prefix: string): boolean => {
  const normalizedPath = normalizePolicyPathValue(path);
  const normalizedPrefix = normalizePolicyPathValue(prefix).replace(/\/+$/, "");

  if (!normalizedPath) {
    return false;
  }

  if (!normalizedPrefix) {
    return true;
  }

  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
};
