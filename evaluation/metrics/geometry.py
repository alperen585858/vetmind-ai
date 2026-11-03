"""Pure geometric validation, not a clinical localization metric."""
from __future__ import annotations
import math
from dataclasses import dataclass

@dataclass(frozen=True)
class Box2D:
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    def __post_init__(self) -> None:
        values=(self.x_min,self.y_min,self.x_max,self.y_max)
        if not all(math.isfinite(v) for v in values):
            raise ValueError("bbox coordinates must be finite")
        if self.x_min > self.x_max or self.y_min > self.y_max:
            raise ValueError("bbox min cannot exceed max")
    @classmethod
    def from_project_box(cls, box: object) -> "Box2D":
        return cls(*(float(getattr(box, field)) for field in
                     ("x_min","y_min","x_max","y_max")))
    @property
    def area(self) -> float:
        return (self.x_max-self.x_min)*(self.y_max-self.y_min)

def intersection_over_union(a: Box2D, b: Box2D) -> float:
    w=max(0.0,min(a.x_max,b.x_max)-max(a.x_min,b.x_min))
    h=max(0.0,min(a.y_max,b.y_max)-max(a.y_min,b.y_min))
    intersection=w*h
    union=a.area+b.area-intersection
    return intersection/union if union>0 else 0.0
