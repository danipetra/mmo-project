import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription, interval, startWith, switchMap } from 'rxjs';

interface ServerStats {
  playersOnline: number;
  uptimeSeconds: number;
}

const SERVER_URL = 'http://localhost:3000';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private subscription?: Subscription;

  stats: ServerStats | null = null;
  connected = false;

  ngOnInit(): void {
    this.subscription = interval(2000)
      .pipe(
        startWith(0),
        switchMap(() => this.http.get<ServerStats>(`${SERVER_URL}/stats`))
      )
      .subscribe({
        next: (stats) => {
          this.stats = stats;
          this.connected = true;
        },
        error: () => {
          this.connected = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
