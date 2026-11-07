import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private branchesService: BranchesService) {}

  @Get()
  async getAllBranches() {

    return this.branchesService.getBranches();
  }

  @Get(':branchId/doctors')
  async getDoctorsByBranch(@Param('branchId', ParseIntPipe) branchId: number) {

    return this.branchesService.getDoctors(branchId);
  }

  @Get(':branchId/doctors/:doctorId/slots')
  async getAvailableSlots(
    @Param('branchId', ParseIntPipe) branchId: number,
    @Param('doctorId', ParseIntPipe) doctorId: number,
    @Query('date') date: string,
  ) {
    return this.branchesService.getSlots(branchId, doctorId, date);
  }
}
