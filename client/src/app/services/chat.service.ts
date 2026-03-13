import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type * as GeoJSON from 'geojson';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | object[];
}

export interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface ToolCallEvent {
  type: 'tool_call';
  name: string;
  label: string;
}

interface FinalEvent {
  type: 'final';
  response: string;
  map_features: GeoJSON.FeatureCollection | null;
  messages: ChatMessage[];
}

interface ErrorEvent {
  type: 'error';
  message: string;
}

type AgentEvent = ToolCallEvent | FinalEvent | ErrorEvent;

@Injectable({ providedIn: 'root' })
export class ChatService {
  private apiMessages: ChatMessage[] = [];
  private abortController: AbortController | null = null;
  private currentBbox: BoundingBox | null = null;

  readonly displayMessages$ = new BehaviorSubject<DisplayMessage[]>([]);
  readonly mapFeatures$ = new BehaviorSubject<GeoJSON.FeatureCollection | null>(null);
  readonly loading$ = new BehaviorSubject<boolean>(false);
  readonly toolActivity$ = new BehaviorSubject<string | null>(null);

  setBbox(bbox: BoundingBox): void {
    this.currentBbox = bbox;
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  sendMessage(text: string): void {
    const display = this.displayMessages$.value;
    this.displayMessages$.next([...display, { role: 'user', text }]);

    this.apiMessages.push({ role: 'user', content: text });
    this.loading$.next(true);
    this.toolActivity$.next(null);
    this.abortController = new AbortController();

    this.streamChat().catch((err) => {
      if (err?.name === 'AbortError') return;
      const updated = this.displayMessages$.value;
      this.displayMessages$.next([
        ...updated,
        { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' },
      ]);
    });
  }

  private async streamChat(): Promise<void> {
    const signal = this.abortController?.signal;
    try {
      const body: Record<string, unknown> = { messages: this.apiMessages };
      if (this.currentBbox) {
        body['bbox'] = this.currentBbox;
      }

      const response = await fetch('/api/chat/stream/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.handleEvent(JSON.parse(trimmed) as AgentEvent);
        }
      }

      if (buffer.trim()) {
        this.handleEvent(JSON.parse(buffer.trim()) as AgentEvent);
      }
    } finally {
      this.loading$.next(false);
      this.toolActivity$.next(null);
      this.abortController = null;
    }
  }

  private handleEvent(event: AgentEvent): void {
    if (event.type === 'tool_call') {
      this.toolActivity$.next(event.label);
    } else if (event.type === 'final') {
      this.apiMessages = event.messages;
      const updated = this.displayMessages$.value;
      this.displayMessages$.next([...updated, { role: 'assistant', text: event.response }]);
      if (event.map_features) {
        this.mapFeatures$.next(event.map_features);
      }
    } else if (event.type === 'error') {
      const updated = this.displayMessages$.value;
      this.displayMessages$.next([
        ...updated,
        { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' },
      ]);
    }
  }

  reset(): void {
    this.apiMessages = [];
    this.displayMessages$.next([]);
    this.mapFeatures$.next(null);
    this.toolActivity$.next(null);
  }
}
