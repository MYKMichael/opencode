import { Script3D } from "laya/d3/component/Script3D"
import { Sprite3D } from "laya/d3/core/Sprite3D"
import { regClass } from "laya/reflect"

@regClass()
export class ClickScale extends Script3D {
  private _originalScale: number = 1
  private _targetScale: number = 1.2
  private _scaleDuration: number = 200
  private _isScaling: boolean = false
  private _scaleStartTime: number = 0

  constructor() {
    super()
  }

  onAwake(): void {
    this._originalScale = this.owner.transform.localScale.x
  }

  onStart(): void {
    this.owner.on("click", this, this.onClick)
  }

  private onClick(): void {
    if (this._isScaling) return

    this._isScaling = true
    this._scaleStartTime = Date.now()
    this._targetScale = this.owner.transform.localScale.x === this._originalScale ? 1.2 : this._originalScale

    this.startScaleAnimation()
  }

  private startScaleAnimation(): void {
    const currentTime = Date.now()
    const elapsed = currentTime - this._scaleStartTime

    if (elapsed >= this._scaleDuration) {
      this.owner.transform.localScale.setValue(this._targetScale, this._targetScale, this._targetScale)
      this._isScaling = false
      return
    }

    const progress = elapsed / this._scaleDuration
    const currentScale = this.easeOutBack(progress, this._originalScale, this._targetScale - this._originalScale)

    this.owner.transform.localScale.setValue(currentScale, currentScale, currentScale)

    Laya.timer.frameOnce(1, this, this.startScaleAnimation)
  }

  private easeOutBack(t: number, b: number, c: number): number {
    const s = 1.70158
    return c * ((t = t - 1) * t * ((s + 1) * t + s) + 1) + b
  }

  onDestroy(): void {
    this.owner.off("click", this, this.onClick)
    Laya.timer.clear(this, this.startScaleAnimation)
  }
}
