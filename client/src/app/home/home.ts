import { Component, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';

interface HealthResponse {
  status: string;
}

@Component({
  selector: 'app-home',
  imports: [CommonModule, MatCardModule, MatProgressSpinnerModule],
  templateUrl: './home.html',
  styles: [`
    .home-container {
      padding: 24px;
      max-width: 600px;
    }
    .status-value {
      font-size: 1.2rem;
      font-weight: 500;
    }
    .status-ok {
      color: #4caf50;
    }
    .status-error {
      color: #f44336;
    }
    .spinner-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
  `]
})
export class HomeComponent implements OnInit {
  health = signal<HealthResponse | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<HealthResponse>('/api/health/').subscribe({
      next: (data) => {
        this.health.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Could not reach the API. Is the Django server running?');
        this.loading.set(false);
      }
    });
  }
}
