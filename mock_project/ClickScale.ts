import {
  Camera,
  Scene3D,
  Sprite3D,
  MeshRenderer,
  PrimitiveMesh,
  BlinnPhongMaterial,
  Vector3,
  Transform3D,
  InputManager,
  Event,
} from "laya/d3/laya"
import { CameraType } from "laya/d3/core/Camera"
import { regClass } from "laya/utils/Decorator"

@regClass()
export class ClickScale extends Laya.Script {
  private originalScale: Vector3 = new Vector3(1, 1, 1)
  private targetScale: Vector3 = new Vector3(1.5, 1.5, 1.5)
  private scaleSpeed: number = 5
  private currentScale: Vector3 = new Vector3()
  private isScalingUp: boolean = false
  private isScalingDown: boolean = false

  onAwake(): void {
    const sprite3D = this.owner as Sprite3D
    this.currentScale.cloneFrom(sprite3D.transform.scale)
  }

  onUpdate(): void {
    const sprite3D = this.owner as Sprite3D

    if (this.isScalingUp || this.isScalingDown) {
      const targetScale = this.isScalingUp ? this.targetScale : this.originalScale
      const scale = Vector3.lerp(this.currentScale, targetScale, (this.scaleSpeed * Laya.timer.delta) / 1000)

      this.currentScale.cloneFrom(scale)
      sprite3D.transform.localScale = this.currentScale

      if (Vector3.distanceSquared(this.currentScale, targetScale) < 0.001) {
        this.currentScale.cloneFrom(targetScale)
        sprite3D.transform.localScale = this.currentScale
        this.isScalingUp = false
        this.isScalingDown = false
      }
    }
  }

  onMouseDown(): void {
    if (this.isScalingUp) {
      this.isScalingUp = false
      this.isScalingDown = true
    } else if (this.isScalingDown) {
      this.isScalingDown = false
      this.isScalingUp = true
    } else {
      this.isScalingUp = true
    }
  }
}

@regClass()
export class ClickScaleScene extends Laya.Scene {
  onAwake(): void {
    this.createScene()
  }

  private createScene(): void {
    const scene = new Scene3D()
    Laya.stage.addChild(scene)

    const camera = new Camera(0, 0.1, 100)
    camera.transform.position = new Vector3(0, 0, 10)
    camera.transform.rotate(new Vector3(0, 0, 0), true, false)
    camera.orthographic = false
    camera.fieldOfView = 60
    scene.addChild(camera)

    const box = new Sprite3D()
    const meshRenderer = box.addComponent(MeshRenderer)
    meshRenderer.mesh = PrimitiveMesh.createBox(2, 2, 2)
    const material = new BlinnPhongMaterial()
    material.albedoColor = new Vector4(0.5, 0.7, 1.0, 1.0)
    meshRenderer.material = material
    scene.addChild(box)

    box.addComponent(ClickScale)
  }
}
