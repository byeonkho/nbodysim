// One recorded HTTP response observed by the page during a journey. The kit
// fills this from Playwright's `page.on("response")` and assertions match
// against the collected list.
export interface RecordedResponse {
  method: string;
  url: string;
  status: number;
}

// Find the first recorded response matching method + url (substring or regex)
// and, optionally, an exact status. Method comparison is case-insensitive.
export function matchResponse(
  recorded: RecordedResponse[],
  method: string,
  urlPattern: string | RegExp,
  status?: number,
): RecordedResponse | undefined {
  const wantMethod = method.toUpperCase();
  return recorded.find((r) => {
    if (r.method.toUpperCase() !== wantMethod) return false;
    const urlOk =
      typeof urlPattern === "string"
        ? r.url.includes(urlPattern)
        : urlPattern.test(r.url);
    if (!urlOk) return false;
    if (status !== undefined && r.status !== status) return false;
    return true;
  });
}
