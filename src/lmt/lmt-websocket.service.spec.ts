import { haversineMeters, calculateBearingDeg } from './lmt-websocket.service';

describe('LmtWebsocketService Math Helpers', () => {
  describe('haversineMeters', () => {
    it('should calculate 0 meters for identical coordinates', () => {
      const dist = haversineMeters(6.840692, 79.975769, 6.840692, 79.975769);
      expect(dist).toBe(0);
    });

    it('should accurately calculate distance between Makumbura and Maharagama', () => {
      const dist = haversineMeters(6.840692, 79.975769, 6.84614, 79.94917);
      expect(dist).toBeGreaterThan(2800);
      expect(dist).toBeLessThan(3100);
    });
  });

  describe('calculateBearingDeg', () => {
    it('should calculate ~90 degrees heading due East', () => {
      const bearing = calculateBearingDeg(6.84, 79.95, 6.84, 79.96);
      expect(bearing).toBe(90);
    });

    it('should calculate ~0 degrees heading due North', () => {
      const bearing = calculateBearingDeg(6.84, 79.95, 6.85, 79.95);
      expect(bearing).toBe(0);
    });

    it('should calculate ~180 degrees heading due South', () => {
      const bearing = calculateBearingDeg(6.85, 79.95, 6.84, 79.95);
      expect(bearing).toBe(180);
    });
  });
});
