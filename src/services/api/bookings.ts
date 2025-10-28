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
  player?: any; // Player object when populated
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
    discordUserId: string,
    additionalData?: { message?: string | null; reason?: string | null }
  ): Promise<Booking> {
    try {
      logInfo('Updating booking status', { bookingId, status, discordUserId, additionalData });
      
      await apiClient.authenticateWithDiscord(discordUserId);
      
      const response = await apiClient.put<Booking>(`/bookings/${bookingId}/status`, {
        status,
        ...additionalData
      });
      return response.data!;
    } catch (error) {
      logError('Failed to update booking status', error as Error, { bookingId, status, discordUserId });
      throw error;
    }
  }
  
  // Get bookings for a game (GM only)
  public async getGameBookings(gameId: string, filters?: { status?: string }): Promise<Booking[]> {
    try {
      logInfo('Fetching game bookings', { gameId, filters });

      const response = await apiClient.get<{ data: Booking[]; pagination?: any }>(`/games/${gameId}/bookings`, filters);
      return response.data!.data;
    } catch (error) {
      logError('Failed to fetch game bookings', error as Error, { gameId, filters });
      throw error;
    }
  }

  // Get current user's bookings
  public async getMyBookings(discordUserId: string): Promise<import('../../types/api').UserBooking[]> {
    try {
      logInfo('Fetching user bookings', { discordUserId });

      // Bot authentication - pass discordId as query parameter
      const response = await apiClient.get<import('../../types/api').UserBookingsResponse>(
        '/bookings/me',
        { discordId: discordUserId }
      );

      logInfo('Raw API response for bookings', {
        discordUserId,
        responseData: response.data,
        bookingsPath: response.data?.bookings,
        bookingsCount: response.data?.bookings?.length || 0
      });

      return response.data?.bookings || [];
    } catch (error) {
      logError('Failed to fetch user bookings', error as Error, { discordUserId });
      throw error;
    }
  }

  // Leave a game (cancel booking)
  public async leaveGame(bookingId: string, discordUserId: string): Promise<void> {
    try {
      logInfo('Leaving game', { bookingId, discordUserId });

      // Bot authentication - no user lookup needed, bot API key is sent automatically
      await apiClient.post(`/bookings/${bookingId}/leave`);

      logInfo('Successfully left game', { bookingId, discordUserId });
    } catch (error) {
      logError('Failed to leave game', error as Error, { bookingId, discordUserId });
      throw error;
    }
  }
}

export const bookingService = new BookingService();