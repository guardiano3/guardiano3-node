import type {
  DecisionFrame,
  DecisionUpdateFrame,
  DegradedFrame,
  ErrorFrame,
  LaggingFrame,
  ReadyFrame,
} from "../generated/src";
import {
  DecisionFrameFromJSON,
  DecisionUpdateFrameFromJSON,
  DegradedFrameFromJSON,
  ErrorFrameFromJSON,
  LaggingFrameFromJSON,
  ReadyFrameFromJSON,
} from "../generated/src";

export interface LiveSessionOptions {
  baseUrl: string;
  credential: string;
  sessionId: string;
  onReady?: (frame: ReadyFrame) => void;
  onDecision?: (frame: DecisionFrame) => void;
  onDecisionUpdate?: (frame: DecisionUpdateFrame) => void;
  onLagging?: (frame: LaggingFrame) => void;
  /**
   * A stretch of the call was not transcribed, so no decision covers it. The
   * session goes on; do not read a quiet stream as a safe call.
   */
  onDegraded?: (frame: DegradedFrame) => void;
  onError?: (frame: ErrorFrame) => void;
  onDisconnect?: (event: { code: number; reason: string }) => void;
}

type StreamFrame =
  | ReadyFrame
  | DecisionFrame
  | DecisionUpdateFrame
  | LaggingFrame
  | DegradedFrame
  | ErrorFrame;

function httpToWs(url: string): string {
  return url.replace(/^http(s?):/, "ws$1:");
}

export class LiveSession {
  private audioWs: WebSocket | null = null;
  private streamWs: WebSocket | null = null;
  private closed = false;
  private readonly opts: LiveSessionOptions;

  constructor(options: LiveSessionOptions) {
    this.opts = options;
  }

  connect(): void {
    if (this.closed) throw new Error("LiveSession is closed.");

    const wsBase = httpToWs(this.opts.baseUrl.replace(/\/+$/, ""));
    const sid = this.opts.sessionId;

    const audioUrl = `${wsBase}/v1/sessions/${sid}/audio`;
    const streamUrl = `${wsBase}/v1/sessions/${sid}/stream`;

    this.audioWs = new WebSocket(audioUrl);
    this.audioWs.binaryType = "arraybuffer";
    this.audioWs.onopen = () => {
      this.audioWs!.send(JSON.stringify({ token: this.opts.credential }));
    };
    this.audioWs.onclose = (ev) => {
      if (!this.closed) this.opts.onDisconnect?.({ code: ev.code, reason: ev.reason });
    };

    this.streamWs = new WebSocket(streamUrl);
    this.streamWs.onopen = () => {
      this.streamWs!.send(JSON.stringify({ token: this.opts.credential }));
    };
    this.streamWs.onmessage = (ev) => {
      this.dispatch(ev.data as string);
    };
    this.streamWs.onclose = (ev) => {
      if (!this.closed) this.opts.onDisconnect?.({ code: ev.code, reason: ev.reason });
    };
  }

  sendAudio(pcm: ArrayBuffer | Uint8Array): void {
    if (!this.audioWs || this.audioWs.readyState !== WebSocket.OPEN) {
      throw new Error("Audio WebSocket is not open.");
    }
    this.audioWs.send(pcm);
  }

  close(): void {
    this.closed = true;
    this.audioWs?.close(1000);
    this.streamWs?.close(1000);
    this.audioWs = null;
    this.streamWs = null;
  }

  private dispatch(raw: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const type = data["type"] as string | undefined;
    switch (type) {
      case "ready":
        this.opts.onReady?.(ReadyFrameFromJSON(data));
        break;
      case "decision":
        this.opts.onDecision?.(DecisionFrameFromJSON(data));
        break;
      case "decisionUpdate":
        this.opts.onDecisionUpdate?.(DecisionUpdateFrameFromJSON(data));
        break;
      case "lagging":
        this.opts.onLagging?.(LaggingFrameFromJSON(data));
        break;
      case "degraded":
        this.opts.onDegraded?.(DegradedFrameFromJSON(data));
        break;
      case "error":
        this.opts.onError?.(ErrorFrameFromJSON(data));
        break;
    }
  }
}
