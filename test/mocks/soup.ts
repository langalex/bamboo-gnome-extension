/**
 * Minimal Soup 3 stub for unit tests (vitest.config.ts aliases
 * `gi://Soup?version=3.0` here). Records every request the client builds and
 * serves scripted responses; if the responder throws, the request rejects
 * (simulating a network failure).
 */

export interface ScriptedResponse {
  status: number;
  body: string;
}

export type SoupResponder = (msg: Message) => ScriptedResponse;

let responder: SoupResponder = () => ({ status: 200, body: "{}" });

/** Script a per-request response factory. */
export function setSoupResponder(fn: SoupResponder): void {
  responder = fn;
}

/** Script one fixed response for every request. */
export function respondWith(status: number, body: string): void {
  setSoupResponder(() => ({ status, body }));
}

class Headers {
  readonly #map = new Map<string, string>();

  append(name: string, value: string): void {
    this.#map.set(name, value);
  }

  get(name: string): string | undefined {
    return this.#map.get(name);
  }
}

export class Message {
  static #last: Message | null = null;

  /** Most recent message created via `Message.new`. */
  static get last(): Message | null {
    return Message.#last;
  }

  readonly method: string;
  readonly url: string;
  readonly requestHeaders = new Headers();
  requestBody: { contentType: string; text: string } | null = null;
  #status = 0;

  static new(method: string, url: string): Message {
    const msg = new Message(method, url);
    Message.#last = msg;
    return msg;
  }

  private constructor(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  get_request_headers(): Headers {
    return this.requestHeaders;
  }

  set_request_body_from_bytes(
    contentType: string,
    bytes: { toArray(): Uint8Array },
  ): void {
    this.requestBody = {
      contentType,
      text: new TextDecoder().decode(bytes.toArray()),
    };
  }

  get_status(): number {
    return this.#status;
  }

  /** Called by the stubbed Session, mirroring what libsoup does. */
  setStatus(status: number): void {
    this.#status = status;
  }
}

export class Session {
  /** Mirrors Soup.Session.abort; a no-op under the test stub. */
  abort(): void {}

  async send_and_read_async(
    msg: Message,
    _priority: number,
    cancellable?: { is_cancelled(): boolean },
  ): Promise<{ toArray(): Uint8Array }> {
    // Yield once so tests can cancel a request while it is in flight, then
    // fail it like libsoup does when the cancellable is triggered.
    await Promise.resolve();
    if (cancellable?.is_cancelled()) {
      throw new Error("Cancelled");
    }
    const { status, body } = responder(msg);
    msg.setStatus(status);
    return { toArray: () => new TextEncoder().encode(body) };
  }
}

const Soup = { Message, Session } as const;
export default Soup;
