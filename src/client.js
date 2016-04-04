'use strict';

var EventEmitter = require('events').EventEmitter;
var debug = require('debug')("raknet");

var createSerializer = require("./transforms/serializer").createSerializer;
var createDeserializer = require("./transforms/serializer").createDeserializer;
var split = require('split-buffer');

const mtuSize=1426;

class Client extends EventEmitter
{
  constructor(port,address)
  {
    super();
    this.address=address;
    this.port=port;
    this.parser=createDeserializer(true);
    this.serializer=createSerializer(true);
    this.parserEncapsulated=createDeserializer(true);
    this.sendSeqNumber=0;
    this.setErrorHandling();
  }

  setErrorHandling()
  {
    this.serializer.on('error', (e) => {
      let parts;
      if(e.field) {
        parts = e.field.split(".");
        parts.shift();
      }
      else
        parts=[];
      e.field = parts.join(".");
      e.message = `Serialization error for ${e.field} : ${e.message}`;
      this.emit('error',e);
    });


    this.parser.on('error', (e) => {
      let parts;
      if(e.field) {
        parts = e.field.split(".");
        parts.shift();
      }
      else
        parts=[];
      e.field = parts.join(".");
      e.message = `Deserialization error for ${e.field} : ${e.message}`;
      this.emit('error',e);
    });


    this.parserEncapsulated.on("error",(e) => {
      let parts;
      if(e.field) {
        parts = e.field.split(".");
        parts.shift();
      }
      else
        parts=[];
      e.field = parts.join(".");
      e.message = `Deserialization error for ${e.field} : ${e.message}`;
      this.emit('error',e);
    });
  }

  setSocket(socket)
  {
    this.socket=socket;
    this.serializer.on("data",(chunk) => {
      socket.send(chunk,0,chunk.length,this.port,this.address);
    });

    const emitPacket=(parsed) =>
    {
      parsed.metadata.name=parsed.data.name;
      parsed.data=parsed.data.params;
      debug("read packet " + parsed.metadata.name);
      debug(JSON.stringify(parsed.data));
      this.emit('packet', parsed.data, parsed.metadata);
      this.emit(parsed.metadata.name, parsed.data, parsed.metadata);
      this.emit('raw.' + parsed.metadata.name, parsed.buffer, parsed.metadata);
      this.emit('raw', parsed.buffer, parsed.metadata);
    };

    this.parserEncapsulated.on("data",(parsed) => {
      emitPacket(parsed);
    });


    this.parser.on("data",(parsed) => {
      emitPacket(parsed);
      if(parsed.metadata.name.substr(0,11)=="data_packet")
      {
        var encapsulatedPackets=parsed.data.encapsulatedPackets;
        encapsulatedPackets.forEach((encapsulatedPacket) => this.parserEncapsulated.write(encapsulatedPacket.buffer));
        this.write("ack",{"packets":[{"one":1,"values":parsed.data.seqNumber}]})
      }
    });
  }

  write(name, params) {
    if(this.ended)
      return;
    debug("writing packet " + name);
    debug(params);
    this.serializer.write({ name, params });
  }

  writeEncapsulated(name, params,priority) {
    priority=priority||4;
    const buffer=this.serializer.createPacketBuffer({ name, params });
    const buffers = split(buffer, mtuSize);

    buffers.forEach(bufferPart => {
      this.write("data_packet_"+priority,{
        seqNumber: this.sendSeqNumber,
        encapsulatedPackets:[{
          reliability: 2,
          hasSplit: 0,
          identifierACK: undefined,
          messageIndex: 0,
          orderIndex: undefined,
          orderChannel: undefined,
          splitCount: undefined,
          splitID: undefined,
          splitIndex: undefined,
          buffer:bufferPart
        }]
      });
      debug("writing packet " + name);
      debug(params);
      this.sendSeqNumber++;
    });
  }

  handleMessage(data)
  {
    debug("handle",data);
    this.parser.write(data);
  }
}


module.exports = Client;