import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BookAppointmentDto {
  @IsInt()
  @IsNotEmpty()
  slotId!: number;

  @IsInt()
  @IsNotEmpty()
  patientId!: number;

  @IsString()
  @IsOptional()
  testRunId?: string;
}