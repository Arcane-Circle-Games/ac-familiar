import { apiClient } from './client';
import { logInfo, logError } from '../../utils/logger';

export interface BookingData {
  gameId: string;
  sessionId?: string;
  playerNotes?: string;
  characterConcept?: string;
}

export interface Booking {
  id: string;
  gameId: string;
  playerId: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'WAITLISTED' | 'CANCELLED';
  playerNotes?: string;
  characterConcept?: string;
  createdAt: string;
  updatedAt: string;
}

export class BookingService {
  
  // Create a new booking
  public async createBooking(data: BookingData, discordUserId: string): Promise<Booking> {
    try {
      logInfo('Creating booking', { data, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.post<Booking>('/bookings', data);
      return response.data!;
    } catch (error) {
      logError('Failed to create booking', error as Error, { data, discordUserId });
      throw error;
    }
  }
  
  // Get a specific booking
  public async getBooking(bookingId: string): Promise<Booking> {
    try {
      logInfo('Fetching booking', { bookingId });
      const response = await apiClient.get<Booking>(`/bookings/${bookingId}`);
      return response.data!;
    } catch (error) {
      logError('Failed to fetch booking', error as Error, { bookingId });
      throw error;
    }
  }
  
  // Update booking status (GM only)
  public async updateBookingStatus(
    bookingId: string,
    status: Booking['status'],
    discordUserId: string
  ): Promise<Booking> {
    try {
      logInfo('Updating booking status', { bookingId, status, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.put<Booking>(`/bookings/${bookingId}/status`, {
        status
      });
      return response.data!;
    } catch (error) {
      logError('Failed to update booking status', error as Error, { bookingId, status, discordUserId });
      throw error;
    }
  }
  
  // Get bookings for a game (GM only)
  public async getGameBookings(gameId: string, discordUserId: string): Promise<Booking[]> {
    try {
      logInfo('Fetching game bookings', { gameId, discordUserId });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.get<{ data: Booking[]; pagination?: any }>(`/games/${gameId}/bookings`);
      return response.data!.data;
    } catch (error) {
      logError('Failed to fetch game bookings', error as Error, { gameId, discordUserId });
      throw error;
    }
  }
}

export const bookingService = new BookingService();