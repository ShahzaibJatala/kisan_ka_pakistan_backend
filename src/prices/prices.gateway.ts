import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Price } from '@prisma/client';

@WebSocketGateway({ cors: true })
export class PricesGateway {
  @WebSocketServer()
  server: Server;

  emitPriceUpdate(price: Price) {
    this.server.emit('priceUpdated', price);
  }
}
