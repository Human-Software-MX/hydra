import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { MonitoreoService } from './monitoreo.service';

@Controller('monitoreo')
export class MonitoreoController {
  constructor(private readonly service: MonitoreoService) {}

  @Get('dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('procesos')
  listarLogs(
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('desde') desde?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.service.listarLogs({ tipo, estado, desde, page, limit });
  }

  @Post('procesos/registrar')
  registrarManual(@Body() body: object) {
    return this.service.registrarManual(body as any);
  }
}
