import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: true, namespace: '/ledger' })
export class LedgerGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('join')
  handleJoin(client: Socket, farmerId: number) {
    client.join(`farmer:${farmerId}`);
  }

  emitToFarmer(farmerUserId: number, event: string, data: any) {
    this.server.to(`farmer:${farmerUserId}`).emit(event, data);
  }
}
