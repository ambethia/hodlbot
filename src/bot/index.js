import GDAX from 'gdax'
import _ from 'lodash'
import num from 'num'

const { API_KEY, SECRET, PASSPHRASE } = process.env

const PRODUCT = 'BTC-USD'
const INTERVAL = 42
const POS_SIZE = 0.042
const MOVEMENT = 0.0042
const DISTANCE = 0.00042

const TRADE = true

class Bot {
  trades = []
  orders = {}
  candles = []
  fairValue
  spread
  interval
  previous
  current
  running = 0
  outlook = 'none'
  bid = { price: num(0), size: num(0) }
  ask = { price: num(0), size: num(0) }
  accounts = []
  pendingBid = false
  pendingAsk = false

  constructor () {
    this.publicClient = new GDAX.PublicClient(PRODUCT)
    this.authedClient = new GDAX.AuthenticatedClient(API_KEY, SECRET, PASSPHRASE)
    this.connect()
    setInterval(() => this.tick(), 0)
    setInterval(() => this.tock(), 1000)
  }

  tick () {
    this.updatePositions()
    this.updateOrders()
  }

  tock () {
    this.getTrades()
    this.syncOrders()
    this.updateAccounts()
    // console.log({
    //   bid: {
    //     price: this.bid.price.toString(),
    //     size: this.bid.size.toString()
    //   },
    //   ask: {
    //     price: this.ask.price.toString(),
    //     size: this.ask.size.toString()
    //   }
    // })
  }

  updateAccounts () {
    this.authedClient.getAccounts((err, resp, data) => {
      if (err) {
        console.error(err)
      } else {
        this.accounts = data
      }
    })
  }

  updateOrders () {
    if (this.fairValue) {
      const bidOrders = this.ordersOn('buy')
      const askOrders = this.ordersOn('sell')
      const staleBids = this.stale(bidOrders)
      const staleAsks = this.stale(askOrders)
      if (staleBids.length > 0 || bidOrders.length === 0) {
        staleBids.forEach(({ id }) => this.authedClient.cancelOrder(id, (err, resp, data) => {
          if (err) console.log('Cancel Bid:', err.message)
          delete this.orders[id]
        }))
        if (!this.pendingBid && bidOrders.length <= 1 && TRADE) {
          this.pendingBid = true
          this.authedClient.buy({
            'price': this.bid.price.toString(),
            'size': this.bid.size.toString(),
            'product_id': PRODUCT
          }, (err, resp, data) => {
            if (err) {
              console.error(err)
            } else {
              this.orders[data.id] = data
              this.pendingBid = false
            }
          })
        }
      }
      if (staleAsks.length > 0 || askOrders.length === 0) {
        staleAsks.forEach(({ id }) => this.authedClient.cancelOrder(id, (err, resp, data) => {
          if (err) console.log('Cancel Ask:', err.message)
          delete this.orders[id]
        }))
        if (!this.pendingAsk && askOrders.length <= 1 && TRADE) {
          this.pendingAsk = true
          this.authedClient.sell({
            'price': this.ask.price.toString(),
            'size': this.ask.size.toString(),
            'product_id': PRODUCT
          }, (err, resp, data) => {
            if (err) {
              console.error(err)
            } else {
              this.orders[data.id] = data
              this.pendingAsk = false
            }
          })
        }
      }
    }
  }

  ordersOn (side) {
    return Object.values(this.orders).filter((o) =>
      o.product_id === PRODUCT && (o.status === 'open' || o.status === 'pending') && o.side === side
    )
  }

  stale (orders) {
    return Object.values(orders).filter((o) => {
      let diff
      if (o.side === 'buy') {
        diff = num(o.price).sub(this.bid.price).abs()
      } else {
        diff = this.ask.price.sub(o.price).abs()
      }
      return diff.gt(0.10)
    })
  }

  syncOrders () {
    this.authedClient.getOrders((err, resp, data) => {
      if (err) {
        console.error('GET ORDERS:', err.message)
      } else {
        data.forEach((order) => {
          this.orders[order.id] = order
        })
      }
    })
  }

  updatePositions () {
    if (this.isMarketReady) {
      let bb // best bid
      let bi = 0
      let bt = num(0)
      while (bt.lt(1)) {
        bb = this.orderBook.bids[bi]
        bt = bt.add(bb.size)
        bi++
      }
      let ba // best ask
      let ai = 0
      let at = num(0)
      while (at.lt(1)) {
        ba = this.orderBook.bids[ai]
        at = at.add(ba.size)
        ai++
      }
      this.fairValue = ba.price.mul(ba.size).add(bb.price.mul(bb.size)).div(ba.size.add(bb.size))
      this.spread = ba.price.sub(bb.price)
      // const width = this.fairValue.mul(DISTANCE)
      // if (this.spread.lt(width)) {
      //   this.bid.price = this.fairValue.sub(width.div(2))
      //   this.ask.price = this.fairValue.add(width.div(2))
      // } else {
      this.bid.price = bb.price.add(0.01)
      this.ask.price = ba.price.sub(0.01)
      // }
      const size = this.fairValue.mul(POS_SIZE).div(4) // TODO increase size
      this.bid.size = size.sub(size.mul(Math.abs(this.running))).div(this.fairValue)
      this.ask.size = size.add(size.mul(Math.abs(this.running))).div(this.fairValue)
      this.bid.price.set_precision(2)
      this.ask.price.set_precision(2)
      this.bid.size.set_precision(4)
      this.ask.size.set_precision(4)
    }
  }

  getTrades () {
    const options = this.trades.length > 0 ? { before: this.trades[0].trade_id } : null
    this.publicClient.getProductTrades(options, (err, resp, data) => {
      if (err) {
        console.error(err)
      } else {
        this.trades = data.concat(this.trades)
        this.updateCandles()
      }
    })
  }

  updateCandles () {
    this.candles = _.map(this.trades.reduce((candles, trade) => {
      const time = Date.parse(trade.time)
      const key = (time - time % (INTERVAL * 1000)).toString()
      if (candles.hasOwnProperty(key)) {
        candles[key].push(trade)
      } else {
        candles[key] = [trade]
      }
      return candles
    }, {}), (trades, key) => {
      return trades.reduce((candle, trade) => {
        candle.high = Math.max(candle.high, trade.price)
        candle.low = Math.min(candle.low, trade.price)
        candle.volume += parseFloat(trade.size)
        return candle
      }, {
        time: new Date(parseInt(key)).toISOString(),
        open: parseFloat(trades[trades.length - 1].price),
        close: parseFloat(trades[0].price),
        high: parseFloat(trades[0].price),
        low: parseFloat(trades[0].price),
        volume: 0
      })
    })

    const lastCandle = this.candles[0]

    if (this.interval !== lastCandle.time) {
      this.interval = lastCandle.time

      const { open, high, low, close } = lastCandle
      const average = [open, high, low, close].reduce((p, c) => p + c) / 4
      this.previous = this.current || average
      this.current = average
      this.running += this.current - this.previous
      if (Math.abs(this.running) > (this.current * MOVEMENT)) {
        console.log('MOVED')
        if (this.running < 0) {
          this.outlook = 'short'
        } else {
          this.outlook = 'long'
        }
        this.running = 0
      }
    }
  }

  connect () {
    this._orderBook = new GDAX.OrderbookSync(PRODUCT)
    this.authedClient.cancelAllOrders(() => console.log('Cancelled orders.'))
  }

  get orderBook () {
    const { _orderBook } = this
    if (_orderBook) {
      return _orderBook.book.state()
    } else {
      return { asks: [], bids: [] }
    }
  }

  get isMarketReady () {
    return this.orderBook.asks.length > 0 && this.orderBook.bids.length > 0
  }
}

export default Bot
