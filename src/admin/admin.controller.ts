import { Controller, Get, Param, ParseIntPipe,Query } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin/branches')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get(':branchId/doctors-n-plus-one')
  async getDoctorsNPlusOne(@Param('branchId', ParseIntPipe) branchId: number) {
    return this.adminService.getBranchDoctorsNPlusOne(branchId);
  }

  @Get(':branchId/doctors-optimized')
  async getDoctorsOptimized(@Param('branchId', ParseIntPipe) branchId: number) {
    return this.adminService.getBranchDoctorsOptimized(branchId);
  }

  @Get(':branchId/bookings-n-plus-one')
    async getBookingsNPlusOne(
      @Param('branchId', ParseIntPipe) branchId: number,
      @Query('date') date: string,
    ) {
      return this.adminService.getBranchBookingsNPlusOne(branchId, date);
    }

    @Get(':branchId/bookings-optimized')
    async getBookingsOptimized(
      @Param('branchId', ParseIntPipe) branchId: number,
      @Query('date') date: string,
    ) {
      return this.adminService.getBranchBookingsOptimized(branchId, date);
    }
}
