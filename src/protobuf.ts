/**
 * Protobuf编码解码器
 * 用于处理JavaScript对象与protobuf二进制数据之间的转换
 */
export class ProtobufEncoder {
  /**
   * 将JavaScript对象编码为protobuf二进制格式
   * @param obj - 要编码的对象
   * @returns 编码后的二进制数据
   */
  encode(obj: any): Uint8Array {
    const buffer: number[] = []
    for (const tag of Object.keys(obj).sort((a, b) => parseInt(a) - parseInt(b))) this._encode(buffer, parseInt(tag), obj[tag])
    return new Uint8Array(buffer)
  }

  /**
   * 将protobuf二进制数据解码为JavaScript对象
   * @param data - 要解码的二进制数据，支持Uint8Array、Buffer或十六进制字符串
   * @returns 解码后的对象
   */
  decode(data: Uint8Array | Buffer | string): any {
    if (typeof data === 'string') data = Buffer.from(data, 'hex')
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data)
    const result: any = {}
    let offset = 0
    while (offset < data.length) {
      const { tag, value, nextOffset } = this._decodeField(data, offset)
      if (!result[tag]) result[tag] = []
      result[tag].push(value)
      offset = nextOffset
    }
    for (const key in result) if (result[key].length === 1) result[key] = result[key][0]
    return result
  }

  /**
   * 解码单个字段
   * @private
   * @param data - 要解码的数据
   * @param offset - 当前偏移位置
   * @returns 解码结果包含标签、值和下一个偏移位置
   */
  private _decodeField(data: Uint8Array, offset: number): { tag: number, value: any, nextOffset: number } {
    const { value: key, nextOffset: keyOffset } = this._readVarint(data, offset)
    const tag = key >>> 3
    const wireType = key & 7
    let value: any
    let nextOffset: number
    switch (wireType) {
      case 0:
        const varintResult = this._readVarint(data, keyOffset)
        value = varintResult.value
        nextOffset = varintResult.nextOffset
        break
      case 2:
        const lengthResult = this._readVarint(data, keyOffset)
        const length = lengthResult.value
        const dataStart = lengthResult.nextOffset
        const dataEnd = dataStart + length
        if (dataEnd > data.length) throw new Error('Invalid length-delimited field')
        const fieldData = data.slice(dataStart, dataEnd)
        try {
          value = this.decode(fieldData)
        } catch {
          try {
            value = new TextDecoder('utf-8', { fatal: true }).decode(fieldData)
          } catch {
            value = fieldData
          }
        }
        nextOffset = dataEnd
        break
      default:
        throw new Error(`Unsupported wire type: ${wireType}`)
    }
    return { tag, value, nextOffset }
  }

  /**
   * 读取可变长度整数
   * @private
   * @param data - 要读取的数据
   * @param offset - 当前偏移位置
   * @returns 读取结果包含值和下一个偏移位置
   */
  private _readVarint(data: Uint8Array, offset: number): { value: number, nextOffset: number } {
    let value = 0
    let shift = 0
    let currentOffset = offset
    while (currentOffset < data.length) {
      const byte = data[currentOffset]
      value |= (byte & 0x7F) << shift
      currentOffset++
      if ((byte & 0x80) === 0) break
      shift += 7
      if (shift >= 32) throw new Error('Varint too long')
    }
    return { value: value >>> 0, nextOffset: currentOffset }
  }

  /**
   * 使用给定标签编码值
   * @private
   * @param buffer - 编码缓冲区
   * @param tag - 字段标签
   * @param value - 要编码的值
   */
  private _encode(buffer: number[], tag: number, value: any): void {
    if (Array.isArray(value)) {
      for (const item of value) this._encodeValue(buffer, tag, item)
    } else {
      this._encodeValue(buffer, tag, value)
    }
  }

  /**
   * 根据类型编码单个值
   * @private
   * @param buffer - 编码缓冲区
   * @param tag - 字段标签
   * @param value - 要编码的值
   */
  private _encodeValue(buffer: number[], tag: number, value: any): void {
    if (value === null || value === undefined) return
    if (typeof value === 'number') {
      this._encodeVarint(buffer, tag, value)
    } else if (typeof value === 'boolean') {
      this._encodeBool(buffer, tag, value)
    } else if (typeof value === 'string') {
      this._encodeString(buffer, tag, value)
    } else if (value instanceof Uint8Array || value instanceof Buffer) {
      this._encodeBytes(buffer, tag, value)
    } else if (typeof value === 'object') {
      const nested = this.encode(value)
      this._encodeBytes(buffer, tag, nested)
    } else {
      throw new TypeError(`Unsupported type ${typeof value}`)
    }
  }

  /**
   * 编码可变长度整数
   * @private
   * @param buffer - 编码缓冲区
   * @param tag - 字段标签
   * @param value - 整数值
   */
  private _encodeVarint(buffer: number[], tag: number, value: number): void {
    const key = (tag << 3) | 0
    this._writeVarint(buffer, key)
    this._writeVarint(buffer, value)
  }

  /**
   * 编码布尔值
   * @private
   * @param buffer - 编码缓冲区
   * @param tag - 字段标签
   * @param value - 布尔值
   */
  private _encodeBool(buffer: number[], tag: number, value: boolean): void {
    this._encodeVarint(buffer, tag, value ? 1 : 0)
  }

  /**
   * 编码字符串值
   * @private
   * @param buffer - 编码缓冲区
   * @param tag - 字段标签
   * @param value - 字符串值
   */
  private _encodeString(buffer: number[], tag: number, value: string): void {
    const key = (tag << 3) | 2
    const encoded = Buffer.from(value, 'utf-8')
    this._writeVarint(buffer, key)
    this._writeVarint(buffer, encoded.length)
    buffer.push(...encoded)
  }

  /**
   * 编码字节数据
   * @private
   * @param buffer - 编码缓冲区
   * @param tag - 字段标签
   * @param value - 字节数据
   */
  private _encodeBytes(buffer: number[], tag: number, value: Uint8Array | Buffer): void {
    const key = (tag << 3) | 2
    this._writeVarint(buffer, key)
    this._writeVarint(buffer, value.length)
    buffer.push(...value)
  }

  /**
   * 向缓冲区写入可变长度整数
   * @private
   * @param buffer - 编码缓冲区
   * @param value - 要写入的整数值
   */
  private _writeVarint(buffer: number[], value: number): void {
    value = value >>> 0
    while (true) {
      const byte = value & 0x7F
      value >>>= 7
      if (value) {
        buffer.push(byte | 0x80)
      } else {
        buffer.push(byte)
        break
      }
    }
  }
}
