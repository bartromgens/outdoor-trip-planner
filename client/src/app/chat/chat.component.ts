import { Component, ElementRef, ViewChild, AfterViewChecked, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ChatService } from '../services/chat.service';
import { MarkdownPipe } from '../pipes/markdown.pipe';

@Component({
  selector: 'app-chat',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MarkdownPipe,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  private chatService = inject(ChatService);

  inputText = '';

  readonly messages$ = this.chatService.displayMessages$;
  readonly loading$ = this.chatService.loading$;
  readonly toolActivity$ = this.chatService.toolActivity$;

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  send(): void {
    const text = this.inputText.trim();
    if (!text) return;
    this.inputText = '';
    this.chatService.sendMessage(text);
  }

  stop(): void {
    this.chatService.stop();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  private scrollToBottom(): void {
    const el = this.scrollContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
