import { Module } from '@nestjs/common';
import { PricesService } from './prices.service';
import { PricesController } from './prices.controller';
import { PricesGateway } from './prices.gateway';

@Module({
  providers: [PricesService, PricesGateway],
  controllers: [PricesController],
})
export class PricesModule {}
