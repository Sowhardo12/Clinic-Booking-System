import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BranchesRepository {
  constructor(private db: DatabaseService) {}

  async findAllBranches() {
    const result = await this.db.query('SELECT * FROM branches WHERE is_active = TRUE ORDER BY id ASC');
    return result.rows;
  }

  async findDoctorsByBranch(branchId: number) {
    const query = `
      SELECT d.id, d.full_name, d.specialty 
      FROM doctors d
      JOIN doctor_branch_assignments dba ON d.id = dba.doctor_id
      WHERE dba.branch_id = $1 AND d.is_active = TRUE
      ORDER BY d.id ASC;
    `;
    const result = await this.db.query(query, [branchId]);
    return result.rows;
  }

  async findAvailableSlots(branchId: number, doctorId: number, date: string) {
    const query = `
      SELECT s.id, s.start_time, s.end_time, s.status, ds.for_date
      FROM appointment_slots s
      JOIN doctor_schedules ds ON s.schedule_id = ds.id
      WHERE ds.branch_id = $1 
        AND ds.doctor_id = $2 
        AND ds.for_date = $3 
        AND s.status = 'available'
      ORDER BY s.start_time ASC;
    `;
    const result = await this.db.query(query, [branchId, doctorId, date]);
    return result.rows;
  }
  
}