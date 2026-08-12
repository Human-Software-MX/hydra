import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PagosExternosService } from './pagos-externos.service';
import { Roles, ROLES_ATENCION } from '../auth/roles.decorator';

@Roles(...ROLES_ATENCION)
@Controller('pagos-externos')
export class PagosExternosController {
  constructor(private readonly service: PagosExternosService) {}

  @Post('upload')
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
  findAll(
    @Query('estado') estado?: string,
    @Query('recaudador') recaudador?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.service.findAll({ estado, recaudador, page, limit });
  }

  @Post(':id/conciliar')
  conciliar(
    @Param('id') id: string,
    @Body() body: { contratoId: string; reciboId?: string },
  ) {
    return this.service.conciliar(id, body.contratoId, body.reciboId);
  }

  @Post(':id/rechazar')
  rechazar(@Param('id') id: string, @Body() body: { motivo: string }) {
    return this.service.rechazar(id, body.motivo);
  }
}
