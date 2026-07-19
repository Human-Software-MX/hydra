import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagosExternosService } from './pagos-externos.service';

@Controller('pagos-externos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PagosExternosController {
  constructor(private readonly service: PagosExternosService) {}

  @Post('upload')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  @UseInterceptors(FileInterceptor('archivo'))
  async upload(
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { recaudador: string },
  ) {
    return this.service.uploadArchivo({
      recaudador: body.recaudador,
      archivoNombre: archivo.originalname,
      contenido: archivo.buffer.toString('latin1'),
    });
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findAll(
    @Query('estado') estado?: string,
    @Query('recaudador') recaudador?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.service.findAll({ estado, recaudador, page, limit });
  }

  @Post(':id/conciliar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  conciliar(
    @Param('id') id: string,
    @Body() body: { contratoId: string; reciboId?: string },
  ) {
    return this.service.conciliar(id, body.contratoId, body.reciboId);
  }

  @Post(':id/rechazar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  rechazar(@Param('id') id: string, @Body() body: { motivo: string }) {
    return this.service.rechazar(id, body.motivo);
  }
}
